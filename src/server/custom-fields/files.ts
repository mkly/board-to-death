import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import {
  MAX_REQUEST_FILE_BYTES,
  SUPPORTED_REQUEST_CONTENT_TYPES,
  validateRequestUpload,
} from "../files/request-policy.ts";
import type { FileStorageService } from "../infrastructure/contracts.ts";
import { contentDisposition, safeFileName } from "../infrastructure/file-names.ts";
import { randomUUID } from "node:crypto";

const OWNER_EVENT_ID = "owner-event-id";

export const CUSTOM_FIELD_FILE_POLICY = {
  allowedContentTypes: SUPPORTED_REQUEST_CONTENT_TYPES,
  maxBytes: MAX_REQUEST_FILE_BYTES,
} as const;

export interface PreparedCustomFieldFile {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
}

export async function prepareCustomFieldFile(file: File, fieldLabel: string): Promise<PreparedCustomFieldFile> {
  const fileName = safeFileName(file.name);
  if (!fileName) throw new RepositoryError("invalid-input", `${fieldLabel} has an invalid file name.`);

  const contentType = file.type.trim();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateRequestUpload(CUSTOM_FIELD_FILE_POLICY, contentType, bytes);
  if (!validation.ok) {
    throw new RepositoryError("invalid-input", `${fieldLabel}: ${validation.message ?? "The file was rejected."}`);
  }
  return { bytes, contentType, fileName };
}

/**
 * Writes an already-validated file. Callers that must reject a bad upload before they mutate any
 * record run `prepareCustomFieldFile` up front and hand the result here.
 */
export async function putCustomFieldFile({
  eventId,
  definitionId,
  fieldLabel,
  pathSegment,
  prepared,
  storage,
}: {
  readonly eventId: string;
  readonly definitionId: string;
  readonly fieldLabel: string;
  readonly pathSegment: string;
  readonly prepared: PreparedCustomFieldFile;
  readonly storage: FileStorageService;
}): Promise<{ readonly objectKey: string; readonly fileName: string }> {
  const objectKey = `events/${eventId}/custom-fields/${definitionId}/${pathSegment}/${randomUUID()}`;
  const stored = await storage.put({
    key: objectKey,
    bytes: prepared.bytes,
    contentType: prepared.contentType,
    contentDisposition: contentDisposition(prepared.fileName),
    metadata: { [OWNER_EVENT_ID]: eventId, definitionId },
  });
  if (!stored.ok) throw new RepositoryError("invalid-input", `${fieldLabel} could not be stored. Try again.`);
  return { objectKey, fileName: prepared.fileName };
}

export async function storeCustomFieldFile({
  file,
  fieldLabel,
  ...rest
}: {
  readonly eventId: string;
  readonly definitionId: string;
  readonly fieldLabel: string;
  readonly pathSegment: string;
  readonly file: File;
  readonly storage: FileStorageService;
}): Promise<{ readonly objectKey: string; readonly fileName: string }> {
  return putCustomFieldFile({ ...rest, fieldLabel, prepared: await prepareCustomFieldFile(file, fieldLabel) });
}

export interface CustomFieldStoredFile {
  readonly fileName: string;
  readonly objectKey: string;
}

export interface CustomFieldFileStore {
  findFile(eventId: string, valueId: string): Promise<CustomFieldStoredFile | undefined>;
}

function fileValue(value: Prisma.JsonValue): CustomFieldStoredFile | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { fileName, objectKey } = value;
  return typeof fileName === "string" && typeof objectKey === "string" ? { fileName, objectKey } : undefined;
}

export function createPrismaCustomFieldFileStore(client: PrismaClient): CustomFieldFileStore {
  return {
    async findFile(eventId, valueId) {
      const stored = await client.customFieldValue.findFirst({
        where: { id: valueId, eventId, definition: { type: "FILE" } },
        select: { value: true },
      });
      return stored ? fileValue(stored.value) : undefined;
    },
  };
}

export interface CustomFieldFileDownload {
  readonly bytes: Uint8Array;
  readonly contentDisposition: string;
  readonly contentType: string;
}

export class CustomFieldFileService {
  readonly #storage: FileStorageService;
  readonly #store: CustomFieldFileStore;

  constructor(options: { readonly storage: FileStorageService; readonly store: CustomFieldFileStore }) {
    this.#storage = options.storage;
    this.#store = options.store;
  }

  async download(eventId: string, valueId: string): Promise<CustomFieldFileDownload | undefined> {
    const record = await this.#store.findFile(eventId, valueId);
    if (!record) return undefined;
    const stored = await this.#storage.get(record.objectKey);
    if (!stored.ok) return undefined;
    const ownerEventId = stored.value.metadata.metadata[OWNER_EVENT_ID] ?? stored.value.metadata.metadata.eventId;
    if (ownerEventId !== eventId) return undefined;
    return {
      bytes: stored.value.bytes,
      contentDisposition: stored.value.metadata.contentDisposition ?? contentDisposition(record.fileName),
      contentType: stored.value.metadata.contentType,
    };
  }
}
