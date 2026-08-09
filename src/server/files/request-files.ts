import {
  contentDisposition,
  type FileStorageService,
  type InfrastructureFailure,
  isSafeObjectKey,
  safeFileName,
} from "../infrastructure/index.ts";
import { type RequestFilePolicy, validateRequestUpload } from "./request-policy.ts";
import { randomUUID } from "node:crypto";

export type FileRequestReplacement = "REPLACE_LATEST" | "KEEP_HISTORY";

export interface FileRequestPolicySnapshot extends RequestFilePolicy {
  readonly replacementPolicy: FileRequestReplacement;
}

/**
 * The service view of an assignment: enough to authorize a principal and to judge an upload,
 * and nothing about how those rows are stored. The Prisma adapter in `prisma-store.ts` maps
 * the real tables onto this shape so the service can be exercised without a database.
 */
export interface FileRequestAssignmentRecord {
  readonly id: string;
  readonly eventId: string;
  readonly requestId: string;
  readonly requestTitle: string;
  readonly requestKey: string;
  readonly status: "PENDING" | "FULFILLED" | "WITHDRAWN";
  readonly requestArchived: boolean;
  readonly policy: FileRequestPolicySnapshot;
  readonly contactId: string | null;
  readonly groupId: string | null;
  readonly submissionId: string | null;
}

export interface StoredFileRecord {
  readonly id: string;
  readonly assignmentId: string;
  readonly objectKey: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly uploadedAt: Date;
  readonly supersededAt: Date | null;
}

export interface RecordFileInput {
  readonly assignmentId: string;
  readonly objectKey: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly supersedeExisting: boolean;
}

export interface RecordFileResult {
  readonly file: StoredFileRecord;
  /** Object keys the write superseded; their objects are the service's to delete. */
  readonly supersededKeys: readonly string[];
}

export interface EventFileEntry {
  readonly requestKey: string;
  readonly requestTitle: string;
  readonly targetLabel: string;
  readonly file: StoredFileRecord;
}

export interface FileRequestStore {
  findAssignment(eventId: string, assignmentId: string): Promise<FileRequestAssignmentRecord | undefined>;
  listAssignmentFiles(assignmentId: string, includeSuperseded: boolean): Promise<readonly StoredFileRecord[]>;
  recordFile(input: RecordFileInput): Promise<RecordFileResult>;
  isGroupMember(eventId: string, groupId: string, contactId: string): Promise<boolean>;
  isSubmissionSpeaker(eventId: string, submissionId: string, speakerId: string): Promise<boolean>;
  listEventFiles(eventId: string): Promise<readonly EventFileEntry[]>;
}

export type FileRequestPrincipal =
  | { readonly role: "admin"; readonly eventId: string }
  | { readonly role: "contact"; readonly eventId: string; readonly contactId: string }
  | { readonly role: "speaker"; readonly eventId: string; readonly speakerId: string };

export interface FileRequestUpload {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface FileRequestFileReference {
  readonly id: string;
  readonly assignmentId: string;
  readonly key: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentDisposition: string;
  readonly size: number;
  readonly uploadedAt: Date;
}

export interface FileRequestDownload {
  readonly reference: FileRequestFileReference;
  readonly bytes: Uint8Array;
}

export interface FileRequestFileServiceOptions {
  readonly storage: FileStorageService;
  readonly store: FileRequestStore;
  readonly createObjectId?: () => string;
}

const OWNER_EVENT_ID = "owner-event-id";
const OWNER_ASSIGNMENT_ID = "owner-assignment-id";
const ORIGINAL_FILE_NAME = "original-file-name";

/**
 * File-request failures reach a respondent's screen, so unlike the storage boundary's
 * deliberately opaque failures they carry a message the person can act on ("this type is not
 * accepted"). Storage failures are folded in by code and keep their own safe message.
 */
export type FileRequestFailureCode = "invalid-input" | "unauthorized" | "not-found" | "conflict" | "unexpected";

export interface FileRequestFailure {
  readonly code: FileRequestFailureCode;
  readonly message: string;
}

export type FileRequestResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FileRequestFailure };

const STORAGE_FAILURE_CODES: Readonly<Record<InfrastructureFailure["code"], FileRequestFailureCode>> = {
  "invalid-input": "invalid-input",
  unauthorized: "unauthorized",
  "not-found": "not-found",
  conflict: "conflict",
  "rate-limited": "unexpected",
  timeout: "unexpected",
  unavailable: "unexpected",
  unexpected: "unexpected",
};

function success<T>(value: T): FileRequestResult<T> {
  return { ok: true, value };
}

function failure<T>(code: FileRequestFailureCode, message: string): FileRequestResult<T> {
  return { ok: false, error: { code, message } };
}

function fromStorage<T>(error: InfrastructureFailure): FileRequestResult<T> {
  return failure(STORAGE_FAILURE_CODES[error.code], error.message);
}

function reference(record: StoredFileRecord): FileRequestFileReference {
  return {
    id: record.id,
    assignmentId: record.assignmentId,
    key: record.objectKey,
    fileName: record.fileName,
    contentType: record.contentType,
    contentDisposition: contentDisposition(record.fileName),
    size: record.size,
    uploadedAt: record.uploadedAt,
  };
}

export class FileRequestFileService {
  readonly #storage: FileStorageService;
  readonly #store: FileRequestStore;
  readonly #createObjectId: () => string;

  constructor(options: FileRequestFileServiceOptions) {
    this.#storage = options.storage;
    this.#store = options.store;
    this.#createObjectId = options.createObjectId ?? randomUUID;
  }

  /**
   * Resolves the assignment a principal is allowed to act on. The event is compared first, so
   * an assignment id from another event is refused before any target relationship is consulted.
   */
  async #authorize(
    principal: FileRequestPrincipal,
    assignmentId: string,
  ): Promise<FileRequestResult<FileRequestAssignmentRecord>> {
    const assignment = await this.#store.findAssignment(principal.eventId, assignmentId);
    if (!assignment || assignment.eventId !== principal.eventId) {
      return failure("not-found", "The file request assignment was not found.");
    }
    if (principal.role === "admin") {
      return success(assignment);
    }
    // Respondents only ever see live work: a withdrawn assignment or an archived request is
    // gone from their side even though an administrator can still read what was collected.
    if (assignment.status === "WITHDRAWN" || assignment.requestArchived) {
      return failure("not-found", "The file request assignment is no longer active.");
    }
    if (principal.role === "contact") {
      if (assignment.contactId === principal.contactId) {
        return success(assignment);
      }
      if (
        assignment.groupId &&
        (await this.#store.isGroupMember(principal.eventId, assignment.groupId, principal.contactId))
      ) {
        return success(assignment);
      }
      return failure("unauthorized", "This file request was not assigned to you.");
    }
    if (
      assignment.submissionId &&
      (await this.#store.isSubmissionSpeaker(principal.eventId, assignment.submissionId, principal.speakerId))
    ) {
      return success(assignment);
    }
    return failure("unauthorized", "This file request was not assigned to you.");
  }

  async upload(
    principal: FileRequestPrincipal,
    assignmentId: string,
    upload: FileRequestUpload,
  ): Promise<FileRequestResult<FileRequestFileReference>> {
    const authorized = await this.#authorize(principal, assignmentId);
    if (!authorized.ok) {
      return authorized;
    }
    const assignment = authorized.value;
    if (assignment.status === "WITHDRAWN" || assignment.requestArchived) {
      return failure("conflict", "This file request is no longer collecting files.");
    }

    const fileName = safeFileName(upload.fileName);
    if (!fileName || upload.contentType.trim() === "") {
      return failure("invalid-input", "The file name or type is not usable.");
    }
    const validation = validateRequestUpload(assignment.policy, upload.contentType, upload.bytes);
    if (!validation.ok) {
      return failure("invalid-input", validation.message ?? "The file was rejected.");
    }

    const key = `events/${assignment.eventId}/file-requests/${assignment.requestId}/assignments/${assignment.id}/${this.#createObjectId()}`;
    if (!isSafeObjectKey(key)) {
      return failure("invalid-input", "The storage key for this file is not usable.");
    }

    const stored = await this.#storage.put({
      key,
      bytes: upload.bytes,
      contentType: upload.contentType,
      contentDisposition: contentDisposition(fileName),
      metadata: {
        [OWNER_EVENT_ID]: assignment.eventId,
        [OWNER_ASSIGNMENT_ID]: assignment.id,
        [ORIGINAL_FILE_NAME]: fileName,
      },
    });
    if (!stored.ok) {
      return fromStorage(stored.error);
    }

    let recorded: RecordFileResult;
    try {
      recorded = await this.#store.recordFile({
        assignmentId: assignment.id,
        objectKey: key,
        fileName,
        contentType: upload.contentType,
        size: upload.bytes.length,
        supersedeExisting: assignment.policy.replacementPolicy === "REPLACE_LATEST",
      });
    } catch (error) {
      // The object is already in storage and nothing points at it. Leaving it behind would
      // be an orphan no request could ever reach, so the failed write takes it with it.
      await this.#storage.delete(key);
      return failure("unexpected", error instanceof Error ? error.message : "The upload could not be recorded.");
    }

    for (const supersededKey of recorded.supersededKeys) {
      await this.#storage.delete(supersededKey);
    }
    return success(reference(recorded.file));
  }

  async list(
    principal: FileRequestPrincipal,
    assignmentId: string,
    options: { readonly includeSuperseded?: boolean } = {},
  ): Promise<FileRequestResult<readonly FileRequestFileReference[]>> {
    const authorized = await this.#authorize(principal, assignmentId);
    if (!authorized.ok) {
      return authorized;
    }
    const files = await this.#store.listAssignmentFiles(
      authorized.value.id,
      principal.role === "admin" && options.includeSuperseded === true,
    );
    return success(files.map(reference));
  }

  async download(
    principal: FileRequestPrincipal,
    assignmentId: string,
    fileId: string,
  ): Promise<FileRequestResult<FileRequestDownload>> {
    const authorized = await this.#authorize(principal, assignmentId);
    if (!authorized.ok) {
      return authorized;
    }
    const files = await this.#store.listAssignmentFiles(authorized.value.id, true);
    const record = files.find((file) => file.id === fileId);
    if (!record) {
      return failure("not-found", "The file was not found.");
    }
    if (record.supersededAt && principal.role !== "admin") {
      return failure("not-found", "The file was replaced.");
    }
    const stored = await this.#storage.get(record.objectKey);
    if (!stored.ok) {
      return fromStorage(stored.error);
    }
    return success({ reference: reference(record), bytes: stored.value.bytes });
  }

  /** Every current file collected for an event, for the administrator archive export. */
  async collectForEvent(eventId: string): Promise<FileRequestResult<readonly CollectedEventFile[]>> {
    const entries = await this.#store.listEventFiles(eventId);
    const collected: CollectedEventFile[] = [];
    for (const entry of entries) {
      const stored = await this.#storage.get(entry.file.objectKey);
      if (!stored.ok) {
        return fromStorage(stored.error);
      }
      collected.push({ ...entry, bytes: stored.value.bytes });
    }
    return success(collected);
  }
}

export interface CollectedEventFile extends EventFileEntry {
  readonly bytes: Uint8Array;
}
