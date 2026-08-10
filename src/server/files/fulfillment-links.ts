import type { PrismaClient } from "@/generated/prisma/client";
import type { ClockService, TokenGeneratorService } from "@/server/infrastructure";

import type { FileRequestFileService, FileRequestUpload } from "./request-files";
import { createHash, randomBytes } from "node:crypto";

export const DEFAULT_FILE_REQUEST_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type FileRequestFulfillmentLinkErrorCode =
  | "invalid-input"
  | "invalid-token"
  | "not-found"
  | "token-generation-failed";

export class FileRequestFulfillmentLinkError extends Error {
  readonly code: FileRequestFulfillmentLinkErrorCode;

  constructor(code: FileRequestFulfillmentLinkErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "FileRequestFulfillmentLinkError";
  }
}

export interface IssuedFileRequestFulfillmentLink {
  readonly assignmentId: string;
  readonly contactId: string;
  readonly email: string;
  readonly expiresAt: Date;
  readonly token: string;
}

export interface FileRequestFulfillmentView {
  readonly assignmentId: string;
  readonly contactId: string;
  readonly title: string;
  readonly instructions: string | null;
  readonly dueAt: Date | null;
  readonly allowedContentTypes: readonly string[];
  readonly maxBytes: number;
  readonly replacementPolicy: "REPLACE_LATEST" | "KEEP_HISTORY";
  readonly fulfilled: boolean;
}

interface FileRequestFulfillmentLinkServiceOptions {
  readonly clock?: ClockService;
  readonly database: PrismaClient;
  readonly linkLifetimeMs?: number;
  readonly tokenGenerator?: TokenGeneratorService;
}

interface ResolvedLink {
  readonly id: string;
  readonly eventId: string;
  readonly view: FileRequestFulfillmentView;
}

const systemClock: ClockService = { now: () => new Date() };
const secureTokenGenerator: TokenGeneratorService = {
  generate: ({ byteLength = 32 }) => ({ ok: true, value: randomBytes(byteLength).toString("base64url") }),
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function positiveDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FileRequestFulfillmentLinkError("invalid-input", "linkLifetimeMs must be a positive integer.");
  }
  return value;
}

export class FileRequestFulfillmentLinkService {
  readonly #clock: ClockService;
  readonly #database: PrismaClient;
  readonly #linkLifetimeMs: number;
  readonly #tokenGenerator: TokenGeneratorService;

  constructor(options: FileRequestFulfillmentLinkServiceOptions) {
    this.#clock = options.clock ?? systemClock;
    this.#database = options.database;
    this.#linkLifetimeMs = positiveDuration(options.linkLifetimeMs ?? DEFAULT_FILE_REQUEST_LINK_LIFETIME_MS);
    this.#tokenGenerator = options.tokenGenerator ?? secureTokenGenerator;
  }

  async issue(eventId: string, assignmentId: string): Promise<readonly IssuedFileRequestFulfillmentLink[]> {
    const assignment = await this.#database.fileRequestAssignment.findUnique({
      where: { eventId_id: { eventId, id: assignmentId } },
      include: {
        contact: { select: { id: true, email: true, archivedAt: true } },
        group: {
          select: {
            members: {
              where: { contact: { archivedAt: null } },
              select: { contact: { select: { id: true, email: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
    if (!assignment || assignment.status === "WITHDRAWN") {
      throw new FileRequestFulfillmentLinkError("not-found", "The file request assignment is not active.");
    }

    let recipients: readonly { readonly id: string; readonly email: string }[] = [];
    if (assignment.contact && !assignment.contact.archivedAt) {
      recipients = [{ id: assignment.contact.id, email: assignment.contact.email }];
    } else if (assignment.group) {
      recipients = assignment.group.members
        .map((membership) => membership.contact)
        .toSorted((first, second) => first.email.localeCompare(second.email));
    }
    if (recipients.length === 0) {
      throw new FileRequestFulfillmentLinkError(
        "invalid-input",
        "This assignment has no active contact who can receive a fulfillment link.",
      );
    }

    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + this.#linkLifetimeMs);
    const issued = recipients.map((recipient) => {
      const generated = this.#tokenGenerator.generate({ purpose: "file-request-fulfillment", byteLength: 32 });
      if (!generated.ok) {
        throw new FileRequestFulfillmentLinkError(
          "token-generation-failed",
          "Unable to issue a file request fulfillment link.",
        );
      }
      return { assignmentId, contactId: recipient.id, email: recipient.email, expiresAt, token: generated.value };
    });

    await this.#database.$transaction(async (transaction) => {
      await transaction.fileRequestFulfillmentLink.updateMany({
        where: { assignmentId, consumedAt: null },
        data: { consumedAt: now },
      });
      await transaction.fileRequestFulfillmentLink.createMany({
        data: issued.map((link) => ({
          assignmentId,
          contactId: link.contactId,
          tokenHash: hashToken(link.token),
          expiresAt,
        })),
      });
    });

    return issued;
  }

  async resolve(inputToken: string): Promise<FileRequestFulfillmentView> {
    return (await this.#resolve(inputToken)).view;
  }

  async fulfill(
    inputToken: string,
    upload: FileRequestUpload,
    files: FileRequestFileService,
  ): Promise<Awaited<ReturnType<FileRequestFileService["upload"]>>> {
    const resolved = await this.#resolve(inputToken);
    const now = this.#clock.now();
    const claimed = await this.#database.fileRequestFulfillmentLink.updateMany({
      where: { id: resolved.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) {
      throw new FileRequestFulfillmentLinkError("invalid-token", "This fulfillment link is invalid or expired.");
    }

    try {
      const result = await files.upload(
        { role: "contact", eventId: resolved.eventId, contactId: resolved.view.contactId },
        resolved.view.assignmentId,
        upload,
      );
      if (result.ok) return result;
      await this.#database.fileRequestFulfillmentLink.updateMany({
        where: { id: resolved.id, consumedAt: now },
        data: { consumedAt: null },
      });
      return result;
    } catch (error) {
      await this.#database.fileRequestFulfillmentLink.updateMany({
        where: { id: resolved.id, consumedAt: now },
        data: { consumedAt: null },
      });
      throw error;
    }
  }

  async #resolve(inputToken: string): Promise<ResolvedLink> {
    const token = inputToken.trim();
    if (token === "") {
      throw new FileRequestFulfillmentLinkError("invalid-token", "This fulfillment link is invalid or expired.");
    }
    const now = this.#clock.now();
    const link = await this.#database.fileRequestFulfillmentLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        contact: { select: { archivedAt: true } },
        assignment: {
          include: {
            request: { select: { archivedAt: true } },
            requestVersion: {
              select: {
                title: true,
                instructions: true,
                allowedContentTypes: true,
                maxBytes: true,
                replacementPolicy: true,
              },
            },
          },
        },
      },
    });
    if (
      !link ||
      link.consumedAt ||
      link.expiresAt <= now ||
      link.contact.archivedAt ||
      link.assignment.status === "WITHDRAWN" ||
      link.assignment.request.archivedAt
    ) {
      throw new FileRequestFulfillmentLinkError("invalid-token", "This fulfillment link is invalid or expired.");
    }

    if (link.assignment.contactId !== link.contactId) {
      const membership = link.assignment.groupId
        ? await this.#database.contactGroupMember.findFirst({
            where: {
              eventId: link.assignment.eventId,
              groupId: link.assignment.groupId,
              contactId: link.contactId,
              group: { archivedAt: null },
              contact: { archivedAt: null },
            },
            select: { id: true },
          })
        : null;
      if (!membership) {
        throw new FileRequestFulfillmentLinkError("invalid-token", "This fulfillment link is invalid or expired.");
      }
    }

    return {
      id: link.id,
      eventId: link.assignment.eventId,
      view: {
        assignmentId: link.assignmentId,
        contactId: link.contactId,
        title: link.assignment.requestVersion.title,
        instructions: link.assignment.requestVersion.instructions,
        dueAt: link.assignment.dueAt,
        allowedContentTypes: link.assignment.requestVersion.allowedContentTypes,
        maxBytes: link.assignment.requestVersion.maxBytes,
        replacementPolicy: link.assignment.requestVersion.replacementPolicy,
        fulfilled: link.assignment.status === "FULFILLED",
      },
    };
  }
}
