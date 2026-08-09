import type {
  FileRequest,
  FileRequestAssignment,
  FileRequestReplacementPolicy,
  FileRequestTargetKind,
  FileRequestVersion,
  Prisma,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import {
  isSupportedRequestContentType,
  MAX_REQUEST_FILE_BYTES,
  SUPPORTED_REQUEST_CONTENT_TYPES,
} from "./request-policy.ts";

export interface FileRequestVersionInput {
  readonly title: string;
  readonly instructions?: string | null;
  readonly dueOffsetDays?: number | null;
  readonly allowedContentTypes: readonly string[];
  readonly maxBytes: number;
  readonly replacementPolicy?: FileRequestReplacementPolicy;
}

export interface CreateFileRequestInput extends FileRequestVersionInput {
  readonly eventId: string;
  readonly targetKind: FileRequestTargetKind;
  readonly key?: string;
}

export type UpdateFileRequestInput = Partial<FileRequestVersionInput>;

export type FileRequestTarget =
  | { readonly kind: "CONTACT"; readonly contactId: string }
  | { readonly kind: "GROUP"; readonly groupId: string }
  | { readonly kind: "SUBMISSION"; readonly submissionId: string };

export interface ListFileRequestsOptions {
  readonly includeArchived?: boolean;
  readonly targetKind?: FileRequestTargetKind;
}

export interface FileRequestWithVersion extends FileRequest {
  readonly currentVersion: FileRequestVersion;
  readonly assignmentCount: number;
  readonly fulfilledCount: number;
}

export interface AssignmentTargetLabel {
  readonly kind: FileRequestTargetKind;
  readonly id: string;
  readonly label: string;
}

export interface AssignmentWithContext extends FileRequestAssignment {
  readonly version: FileRequestVersion;
  readonly target: AssignmentTargetLabel;
  readonly fileCount: number;
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

/**
 * The request key is the stable per-event handle an integration can address, so it has to
 * survive a URL path segment even when it is derived from a free-text title.
 */
export function slugifyRequestKey(value: string): string {
  const key = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (key === "") invalid("title must contain at least one alphanumeric character.");
  return key;
}

function normalizeAllowedContentTypes(values: readonly string[]): string[] {
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value !== ""))];
  if (normalized.length === 0) invalid("At least one accepted file type is required.");
  const unsupported = normalized.filter((value) => !isSupportedRequestContentType(value));
  if (unsupported.length > 0) {
    invalid(
      `Unsupported file type: ${unsupported.join(", ")}. Choose from ${SUPPORTED_REQUEST_CONTENT_TYPES.join(", ")}.`,
    );
  }
  return normalized;
}

function normalizeMaxBytes(value: number): number {
  if (!Number.isInteger(value) || value <= 0) invalid("maxBytes must be a positive whole number of bytes.");
  if (value > MAX_REQUEST_FILE_BYTES) invalid(`maxBytes cannot exceed ${MAX_REQUEST_FILE_BYTES} bytes.`);
  return value;
}

function normalizeDueOffsetDays(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) invalid("dueOffsetDays must be zero or a positive whole number of days.");
  return value;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError("conflict", "That file request or assignment already exists for this event.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned file request reference was not found.");
    }
  }
  throw error;
}

export async function createFileRequest(
  client: Prisma.TransactionClient,
  input: CreateFileRequestInput,
): Promise<FileRequestWithVersion> {
  const title = requiredText(input.title, "title");
  const key = input.key === undefined ? slugifyRequestKey(title) : slugifyRequestKey(input.key);
  const allowedContentTypes = normalizeAllowedContentTypes(input.allowedContentTypes);
  const maxBytes = normalizeMaxBytes(input.maxBytes);
  const dueOffsetDays = normalizeDueOffsetDays(input.dueOffsetDays);

  try {
    const request = await client.fileRequest.create({
      data: {
        eventId: input.eventId,
        key,
        targetKind: input.targetKind,
        versions: {
          create: {
            versionNumber: 1,
            title,
            instructions: optionalText(input.instructions),
            dueOffsetDays,
            allowedContentTypes,
            maxBytes,
            replacementPolicy: input.replacementPolicy ?? "REPLACE_LATEST",
          },
        },
      },
      include: { versions: true },
    });
    const currentVersion = request.versions[0];
    if (!currentVersion) throw new RepositoryError("not-found", "The file request version was not created.");
    return { ...request, currentVersion, assignmentCount: 0, fulfilledCount: 0 };
  } catch (error) {
    mapDatabaseError(error);
  }
}

async function requireRequest(
  client: Prisma.TransactionClient,
  eventId: string,
  requestId: string,
): Promise<FileRequest> {
  const request = await client.fileRequest.findUnique({ where: { eventId_id: { eventId, id: requestId } } });
  if (!request) throw new RepositoryError("not-found", "The event-owned file request was not found.");
  return request;
}

export async function getCurrentVersion(
  client: Prisma.TransactionClient,
  eventId: string,
  requestId: string,
): Promise<FileRequestVersion> {
  const version = await client.fileRequestVersion.findFirst({
    where: { eventId, requestId },
    orderBy: { versionNumber: "desc" },
  });
  if (!version) throw new RepositoryError("not-found", "The file request has no version.");
  return version;
}

/**
 * Editing a request appends a version rather than mutating one. Assignments keep pointing at
 * the version they were created against, which is what makes the upload policy a respondent
 * was shown the policy their upload is judged by.
 */
export async function updateFileRequest(
  client: Prisma.TransactionClient,
  eventId: string,
  requestId: string,
  input: UpdateFileRequestInput,
): Promise<FileRequestVersion> {
  await requireRequest(client, eventId, requestId);
  const current = await getCurrentVersion(client, eventId, requestId);

  const title = input.title === undefined ? current.title : requiredText(input.title, "title");
  const instructions = input.instructions === undefined ? current.instructions : optionalText(input.instructions);
  const dueOffsetDays =
    input.dueOffsetDays === undefined ? current.dueOffsetDays : normalizeDueOffsetDays(input.dueOffsetDays);
  const allowedContentTypes =
    input.allowedContentTypes === undefined
      ? current.allowedContentTypes
      : normalizeAllowedContentTypes(input.allowedContentTypes);
  const maxBytes = input.maxBytes === undefined ? current.maxBytes : normalizeMaxBytes(input.maxBytes);

  try {
    return await client.fileRequestVersion.create({
      data: {
        eventId,
        requestId,
        versionNumber: current.versionNumber + 1,
        title,
        instructions,
        dueOffsetDays,
        allowedContentTypes,
        maxBytes,
        replacementPolicy: input.replacementPolicy ?? current.replacementPolicy,
      },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function archiveFileRequest(
  client: Prisma.TransactionClient,
  eventId: string,
  requestId: string,
): Promise<FileRequest> {
  try {
    return await client.fileRequest.update({
      where: { eventId_id: { eventId, id: requestId } },
      data: { archivedAt: new Date() },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function restoreFileRequest(
  client: Prisma.TransactionClient,
  eventId: string,
  requestId: string,
): Promise<FileRequest> {
  try {
    return await client.fileRequest.update({
      where: { eventId_id: { eventId, id: requestId } },
      data: { archivedAt: null },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function listFileRequests(
  client: Prisma.TransactionClient,
  eventId: string,
  options: ListFileRequestsOptions = {},
): Promise<readonly FileRequestWithVersion[]> {
  const requests = await client.fileRequest.findMany({
    where: {
      eventId,
      ...(options.targetKind === undefined ? {} : { targetKind: options.targetKind }),
      ...(options.includeArchived === true ? {} : { archivedAt: null }),
    },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      assignments: { select: { status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return requests.flatMap((request) => {
    const currentVersion = request.versions[0];
    if (!currentVersion) return [];
    const active = request.assignments.filter((assignment) => assignment.status !== "WITHDRAWN");
    return [
      {
        ...request,
        currentVersion,
        assignmentCount: active.length,
        fulfilledCount: active.filter((assignment) => assignment.status === "FULFILLED").length,
      },
    ];
  });
}

function targetLabel(assignment: {
  readonly contactId: string | null;
  readonly groupId: string | null;
  readonly submissionId: string | null;
  readonly contact: { readonly givenName: string; readonly familyName: string; readonly email: string } | null;
  readonly group: { readonly name: string } | null;
  readonly submission: { readonly id: string } | null;
}): AssignmentTargetLabel {
  if (assignment.contactId && assignment.contact) {
    const name = `${assignment.contact.givenName} ${assignment.contact.familyName}`.trim();
    return { kind: "CONTACT", id: assignment.contactId, label: name === "" ? assignment.contact.email : name };
  }
  if (assignment.groupId && assignment.group) {
    return { kind: "GROUP", id: assignment.groupId, label: assignment.group.name };
  }
  if (assignment.submissionId && assignment.submission) {
    return {
      kind: "SUBMISSION",
      id: assignment.submissionId,
      label: `Submission ${assignment.submissionId.slice(0, 8)}`,
    };
  }
  throw new RepositoryError("not-found", "The file request assignment has no resolvable target.");
}

const ASSIGNMENT_CONTEXT = {
  requestVersion: true,
  contact: { select: { givenName: true, familyName: true, email: true } },
  group: { select: { name: true } },
  submission: { select: { id: true } },
  files: { where: { supersededAt: null }, select: { id: true } },
} as const;

export async function listRequestAssignments(
  client: Prisma.TransactionClient,
  eventId: string,
  requestId: string,
): Promise<readonly AssignmentWithContext[]> {
  const assignments = await client.fileRequestAssignment.findMany({
    where: { eventId, requestId },
    include: ASSIGNMENT_CONTEXT,
    orderBy: { assignedAt: "asc" },
  });
  return assignments.map((assignment) => ({
    ...assignment,
    version: assignment.requestVersion,
    target: targetLabel(assignment),
    fileCount: assignment.files.length,
  }));
}

async function resolveDueAt(
  client: Prisma.TransactionClient,
  eventId: string,
  dueOffsetDays: number | null,
): Promise<Date | null> {
  if (dueOffsetDays === null) return null;
  const event = await client.event.findUnique({ where: { id: eventId }, select: { startsAt: true } });
  if (!event) throw new RepositoryError("not-found", "The event was not found.");
  return new Date(event.startsAt.getTime() - dueOffsetDays * 24 * 60 * 60 * 1000);
}

/**
 * Every target is re-read under the event scope before it is attached. An assignment row is
 * the one place an id belonging to another event could otherwise reach this event's request.
 */
async function requireTarget(
  client: Prisma.TransactionClient,
  eventId: string,
  request: FileRequest,
  target: FileRequestTarget,
): Promise<void> {
  if (target.kind !== request.targetKind) {
    invalid(`This file request targets ${request.targetKind.toLowerCase()}s.`);
  }
  if (target.kind === "CONTACT") {
    const contact = await client.contact.findUnique({
      where: { eventId_id: { eventId, id: target.contactId } },
      select: { archivedAt: true },
    });
    if (!contact) throw new RepositoryError("not-found", "The event-owned contact was not found.");
    if (contact.archivedAt) invalid("The contact is archived.");
    return;
  }
  if (target.kind === "GROUP") {
    const group = await client.contactGroup.findUnique({
      where: { eventId_id: { eventId, id: target.groupId } },
      select: { archivedAt: true },
    });
    if (!group) throw new RepositoryError("not-found", "The event-owned contact group was not found.");
    if (group.archivedAt) invalid("The contact group is archived.");
    return;
  }
  const submission = await client.cfpSubmission.findUnique({
    where: { eventId_id: { eventId, id: target.submissionId } },
    select: { id: true },
  });
  if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
}

export async function assignFileRequest(
  client: Prisma.TransactionClient,
  eventId: string,
  requestId: string,
  target: FileRequestTarget,
): Promise<FileRequestAssignment> {
  const request = await requireRequest(client, eventId, requestId);
  if (request.archivedAt) invalid("The file request is archived.");
  await requireTarget(client, eventId, request, target);

  const version = await getCurrentVersion(client, eventId, requestId);
  const dueAt = await resolveDueAt(client, eventId, version.dueOffsetDays);

  try {
    return await client.fileRequestAssignment.create({
      data: {
        eventId,
        requestId,
        requestVersionId: version.id,
        contactId: target.kind === "CONTACT" ? target.contactId : null,
        groupId: target.kind === "GROUP" ? target.groupId : null,
        submissionId: target.kind === "SUBMISSION" ? target.submissionId : null,
        dueAt,
      },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function withdrawAssignment(
  client: Prisma.TransactionClient,
  eventId: string,
  assignmentId: string,
): Promise<FileRequestAssignment> {
  try {
    return await client.fileRequestAssignment.update({
      where: { eventId_id: { eventId, id: assignmentId } },
      data: { status: "WITHDRAWN", withdrawnAt: new Date() },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}
