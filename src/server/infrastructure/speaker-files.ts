import type {
  FileStorageService,
  InfrastructureFailure,
  InfrastructureResult,
  StoredFileMetadata,
} from "./contracts.ts";
import { isSafeObjectKey } from "./object-key.ts";
import { infrastructureFailure, infrastructureSuccess } from "./results.ts";
import { randomUUID } from "node:crypto";

const OWNER_EVENT_ID = "owner-event-id";
const OWNER_SPEAKER_ID = "owner-speaker-id";
const ORIGINAL_FILE_NAME = "original-file-name";

export interface SpeakerFileOwner {
  readonly eventId: string;
  readonly speakerId: string;
}

export type SpeakerFilePrincipal =
  | { readonly role: "admin"; readonly eventId: string }
  | { readonly role: "speaker"; readonly eventId: string; readonly speakerId: string };

export interface SpeakerFileWrite extends SpeakerFileOwner {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface SpeakerFileReference extends SpeakerFileOwner {
  readonly key: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentDisposition: string;
  readonly size: number;
  readonly etag: string;
}

export interface SpeakerFileDownload {
  readonly reference: SpeakerFileReference;
  readonly bytes: Uint8Array;
}

export interface SpeakerFileServiceOptions {
  readonly storage: FileStorageService;
  readonly createObjectId?: () => string;
}

function safeFileName(fileName: string): string | undefined {
  if (!fileName.isWellFormed()) {
    return undefined;
  }
  const baseName = fileName
    .split(/[\\/]/)
    .at(-1)
    ?.split("")
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
  if (!baseName || baseName === "." || baseName === "..") {
    return undefined;
  }
  const truncatedLength = baseName.length > 255 && /[\uD800-\uDBFF]/.test(baseName.at(254) ?? "") ? 254 : 255;
  return baseName.slice(0, truncatedLength);
}

function contentDisposition(fileName: string): string {
  const asciiName = fileName.replaceAll(/[^a-zA-Z0-9._ -]/g, "_").replaceAll('"', "_") || "download";
  const encodedName = encodeURIComponent(fileName).replaceAll(
    /[()'*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

function canAccess(owner: SpeakerFileOwner, principal: SpeakerFilePrincipal): boolean {
  return owner.eventId === principal.eventId && (principal.role === "admin" || owner.speakerId === principal.speakerId);
}

function ownerFromMetadata(metadata: StoredFileMetadata): SpeakerFileOwner | undefined {
  const eventId = metadata.metadata[OWNER_EVENT_ID];
  const speakerId = metadata.metadata[OWNER_SPEAKER_ID];
  return eventId && speakerId ? { eventId, speakerId } : undefined;
}

function referenceFromMetadata(metadata: StoredFileMetadata): SpeakerFileReference | undefined {
  const owner = ownerFromMetadata(metadata);
  const fileName = metadata.metadata[ORIGINAL_FILE_NAME];
  if (!owner || !fileName || !metadata.contentDisposition) {
    return undefined;
  }
  return {
    ...owner,
    key: metadata.key,
    fileName,
    contentType: metadata.contentType,
    contentDisposition: metadata.contentDisposition,
    size: metadata.size,
    etag: metadata.etag,
  };
}

function invalidInput<T>(): InfrastructureResult<T> {
  return infrastructureFailure("file-storage", "invalid-input");
}

function preserveFailure<T>(error: InfrastructureFailure): InfrastructureResult<T> {
  return { ok: false, error };
}

export class SpeakerFileService {
  readonly #storage: FileStorageService;
  readonly #createObjectId: () => string;

  constructor(options: SpeakerFileServiceOptions) {
    this.#storage = options.storage;
    this.#createObjectId = options.createObjectId ?? randomUUID;
  }

  async write(input: SpeakerFileWrite): Promise<InfrastructureResult<SpeakerFileReference>> {
    const fileName = safeFileName(input.fileName);
    const objectId = this.#createObjectId();
    const key = `events/${input.eventId}/speakers/${input.speakerId}/${objectId}`;
    if (!fileName || input.contentType.trim() === "" || !isSafeObjectKey(key)) {
      return invalidInput();
    }

    const stored = await this.#storage.put({
      key,
      bytes: input.bytes,
      contentType: input.contentType,
      contentDisposition: contentDisposition(fileName),
      metadata: {
        [OWNER_EVENT_ID]: input.eventId,
        [OWNER_SPEAKER_ID]: input.speakerId,
        [ORIGINAL_FILE_NAME]: fileName,
      },
    });
    if (!stored.ok) {
      return preserveFailure(stored.error);
    }

    const reference = referenceFromMetadata(stored.value);
    return reference ? infrastructureSuccess(reference) : infrastructureFailure("file-storage", "unexpected");
  }

  async read(key: string, principal: SpeakerFilePrincipal): Promise<InfrastructureResult<SpeakerFileDownload>> {
    if (!isSafeObjectKey(key)) {
      return invalidInput();
    }
    const stored = await this.#storage.get(key);
    if (!stored.ok) {
      return preserveFailure(stored.error);
    }
    const reference = referenceFromMetadata(stored.value.metadata);
    if (!reference) {
      return infrastructureFailure("file-storage", "unexpected");
    }
    if (!canAccess(reference, principal)) {
      return infrastructureFailure("file-storage", "unauthorized");
    }
    return infrastructureSuccess({ reference, bytes: stored.value.bytes });
  }

  async replace(
    currentKey: string,
    input: SpeakerFileWrite,
    principal: SpeakerFilePrincipal,
  ): Promise<InfrastructureResult<SpeakerFileReference>> {
    const current = await this.read(currentKey, principal);
    if (!current.ok) {
      return preserveFailure(current.error);
    }
    if (current.value.reference.eventId !== input.eventId || current.value.reference.speakerId !== input.speakerId) {
      return infrastructureFailure("file-storage", "unauthorized");
    }

    const replacement = await this.write(input);
    if (!replacement.ok) {
      return replacement;
    }
    const removed = await this.#storage.delete(currentKey);
    if (removed.ok && removed.value) {
      return replacement;
    }

    await this.#storage.delete(replacement.value.key);
    return removed.ok ? infrastructureFailure("file-storage", "not-found") : preserveFailure(removed.error);
  }

  async remove(key: string, principal: SpeakerFilePrincipal): Promise<InfrastructureResult<boolean>> {
    const current = await this.read(key, principal);
    if (!current.ok) {
      return preserveFailure(current.error);
    }
    return this.#storage.delete(key);
  }
}
