import { CfpDraftPolicy, type Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import type { ClockService, TokenGeneratorService } from "../infrastructure/index.ts";
import { createHash, randomBytes } from "node:crypto";

const DEFAULT_DRAFT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

interface DraftScope {
  readonly eventId: string;
  readonly policyId: string;
}

export interface SaveCfpDraftInput extends DraftScope {
  readonly draftPolicy: CfpDraftPolicy;
  readonly formVersionId: string;
  readonly answers: Record<string, unknown>;
  readonly participants: readonly unknown[];
  readonly categoryKeys: readonly string[];
  readonly token?: string;
}

export interface SavedCfpDraft {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface ResumeCfpDraftInput extends DraftScope {
  readonly draftPolicy: CfpDraftPolicy;
  readonly token: string;
  readonly currentFormVersionId: string;
}

export interface ResumedCfpDraft {
  readonly formVersionId: string;
  readonly formVersionChanged: boolean;
  readonly answers: Record<string, unknown>;
  readonly participants: readonly unknown[];
  readonly categoryKeys: readonly string[];
  readonly expiresAt: Date;
}

export interface DiscardCfpDraftInput extends DraftScope {
  readonly token: string;
}

interface CfpDraftRepositoryOptions {
  readonly clock?: ClockService;
  readonly database: PrismaClient;
  readonly draftLifetimeMs?: number;
  readonly tokenGenerator?: TokenGeneratorService;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const systemClock: ClockService = { now: () => new Date() };
const secureTokenGenerator: TokenGeneratorService = {
  generate: ({ byteLength = 32 }) => ({ ok: true, value: randomBytes(byteLength).toString("base64url") }),
};

function requireEnabled(draftPolicy: CfpDraftPolicy): void {
  if (draftPolicy === CfpDraftPolicy.DISABLED) {
    throw new RepositoryError("invalid-input", "Drafts are not enabled for this form.");
  }
}

function requireToken(token: string): string {
  if (token.trim() === "") {
    throw new RepositoryError("not-found", "The draft link is invalid or has expired.");
  }
  return token;
}

/**
 * Draft tokens behave like bearer session tokens, not single-use magic
 * links: resuming (reading) a draft never rotates or extends its token, so
 * the same resume link stays valid across repeated opens (e.g. multiple
 * tabs or devices) until it expires or the draft is discarded. Only an
 * explicit save slides the expiry forward. Every rejection - tampered,
 * expired, or scoped to a different policy/event - surfaces as the same
 * "not-found" error so a guessed token cannot distinguish those cases.
 */
export class CfpDraftRepository {
  readonly #clock: ClockService;
  readonly #database: PrismaClient;
  readonly #draftLifetimeMs: number;
  readonly #tokenGenerator: TokenGeneratorService;

  constructor(options: CfpDraftRepositoryOptions) {
    this.#clock = options.clock ?? systemClock;
    this.#database = options.database;
    this.#draftLifetimeMs = options.draftLifetimeMs ?? DEFAULT_DRAFT_LIFETIME_MS;
    this.#tokenGenerator = options.tokenGenerator ?? secureTokenGenerator;
  }

  async save(input: SaveCfpDraftInput): Promise<SavedCfpDraft> {
    requireEnabled(input.draftPolicy);

    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + this.#draftLifetimeMs);
    const data = {
      formVersionId: input.formVersionId,
      answers: inputJson(input.answers),
      participants: inputJson(input.participants),
      categoryKeys: inputJson(input.categoryKeys),
      expiresAt,
      updatedAt: now,
    };

    if (input.token !== undefined) {
      const token = requireToken(input.token);
      const updated = await this.#database.cfpSubmissionDraft.updateMany({
        where: { eventId: input.eventId, policyId: input.policyId, tokenHash: hashToken(token) },
        data,
      });
      if (updated.count !== 1) {
        throw new RepositoryError("not-found", "The draft link is invalid or has expired.");
      }
      return { token, expiresAt };
    }

    const generated = this.#tokenGenerator.generate({ purpose: "cfp-submission-draft", byteLength: 32 });
    if (!generated.ok) {
      throw new RepositoryError("invalid-input", "Unable to issue a draft token.");
    }
    const token = generated.value;
    await this.#database.cfpSubmissionDraft.create({
      data: {
        eventId: input.eventId,
        policyId: input.policyId,
        tokenHash: hashToken(token),
        createdAt: now,
        ...data,
      },
    });
    return { token, expiresAt };
  }

  async resume(input: ResumeCfpDraftInput): Promise<ResumedCfpDraft> {
    requireEnabled(input.draftPolicy);
    const token = requireToken(input.token);

    const now = this.#clock.now();
    const draft = await this.#database.cfpSubmissionDraft.findFirst({
      where: {
        eventId: input.eventId,
        policyId: input.policyId,
        tokenHash: hashToken(token),
        expiresAt: { gt: now },
      },
    });
    if (!draft) {
      throw new RepositoryError("not-found", "The draft link is invalid or has expired.");
    }

    return {
      formVersionId: draft.formVersionId,
      formVersionChanged: draft.formVersionId !== input.currentFormVersionId,
      answers: draft.answers as Record<string, unknown>,
      participants: draft.participants as unknown[],
      categoryKeys: draft.categoryKeys as string[],
      expiresAt: draft.expiresAt,
    };
  }

  async discard(input: DiscardCfpDraftInput): Promise<void> {
    const token = requireToken(input.token);
    await this.#database.cfpSubmissionDraft.deleteMany({
      where: { eventId: input.eventId, policyId: input.policyId, tokenHash: hashToken(token) },
    });
  }
}
