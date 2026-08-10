import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
} from "@aws-sdk/client-s3";

import type {
  FileStorageService,
  FileWrite,
  InfrastructureFailureCode,
  InfrastructureResult,
  StoredFile,
} from "./contracts.ts";
import { isSafeObjectKey } from "./object-key.ts";
import { infrastructureFailure, infrastructureSuccess } from "./results.ts";

export interface S3FileStorageOptions {
  readonly bucket: string;
  readonly region: string;
  /** Non-AWS endpoint for S3-compatible services (MinIO, LocalStack, R2). */
  readonly endpoint?: string;
  /** Path-style addressing (`endpoint/bucket/key`), required by most local S3 emulators. */
  readonly forcePathStyle?: boolean;
}

function isS3ServiceException(error: unknown): error is S3ServiceException {
  return error instanceof Error && "$metadata" in error;
}

function failureCode(error: unknown): InfrastructureFailureCode {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "timeout";
  }
  if (!isS3ServiceException(error)) {
    return "unexpected";
  }
  switch (error.name) {
    case "NoSuchKey":
    case "NoSuchBucket":
    case "NotFound":
      return "not-found";
    case "AccessDenied":
    case "InvalidAccessKeyId":
    case "SignatureDoesNotMatch":
    case "ExpiredToken":
    case "TokenRefreshRequired":
      return "unauthorized";
    case "SlowDown":
    case "Throttling":
    case "ThrottlingException":
    case "RequestTimeout":
      return "rate-limited";
    default:
      break;
  }
  const status = error.$metadata.httpStatusCode;
  if (status === 404) {
    return "not-found";
  }
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 429) {
    return "rate-limited";
  }
  if (status !== undefined && status >= 500) {
    return "unavailable";
  }
  return "unexpected";
}

/**
 * S3 user metadata travels in HTTP headers, so values must stay US-ASCII while
 * callers store arbitrary well-formed strings (uploaded file names in
 * particular). Values are percent-encoded on write and decoded on read so the
 * metadata round-trips byte for byte — authorization reads owner ids back out
 * of it and must see exactly what was written.
 */
function encodeMetadata(metadata: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(metadata ?? {}).map(([key, value]) => [key, encodeURIComponent(value)]));
}

function decodeMetadata(metadata: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).map(([key, value]) => {
      try {
        return [key, decodeURIComponent(value)];
      } catch {
        return [key, value];
      }
    }),
  );
}

function normalizeEtag(etag: string | undefined): string {
  return etag ? etag.replaceAll('"', "") : "";
}

export class S3FileStorage implements FileStorageService {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(options: S3FileStorageOptions) {
    if (options.bucket.trim() === "" || options.region.trim() === "") {
      throw new TypeError("S3 file storage requires a bucket and a region.");
    }
    this.#bucket = options.bucket;
    this.#client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
    });
  }

  async put(file: FileWrite): Promise<InfrastructureResult<StoredFile["metadata"]>> {
    if (!isSafeObjectKey(file.key) || file.contentType.trim().length === 0) {
      return infrastructureFailure("file-storage", "invalid-input");
    }

    try {
      const response = await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: file.key,
          Body: file.bytes,
          ContentType: file.contentType,
          ContentDisposition: file.contentDisposition,
          Metadata: encodeMetadata(file.metadata),
        }),
      );

      return infrastructureSuccess({
        key: file.key,
        contentType: file.contentType,
        size: file.bytes.byteLength,
        etag: normalizeEtag(response.ETag),
        contentDisposition: file.contentDisposition,
        metadata: { ...file.metadata },
      });
    } catch (error) {
      return infrastructureFailure("file-storage", failureCode(error));
    }
  }

  async get(key: string): Promise<InfrastructureResult<StoredFile>> {
    if (!isSafeObjectKey(key)) {
      return infrastructureFailure("file-storage", "invalid-input");
    }

    try {
      const response = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
      const bytes = await response.Body?.transformToByteArray();
      if (bytes === undefined || !response.ContentType) {
        return infrastructureFailure("file-storage", "unexpected");
      }

      return infrastructureSuccess({
        metadata: {
          key,
          contentType: response.ContentType,
          size: bytes.byteLength,
          etag: normalizeEtag(response.ETag),
          contentDisposition: response.ContentDisposition,
          metadata: decodeMetadata(response.Metadata),
        },
        bytes,
      });
    } catch (error) {
      return infrastructureFailure("file-storage", failureCode(error));
    }
  }

  async delete(key: string): Promise<InfrastructureResult<boolean>> {
    if (!isSafeObjectKey(key)) {
      return infrastructureFailure("file-storage", "invalid-input");
    }

    // DeleteObject succeeds whether or not the object exists, but the contract
    // reports whether anything was removed, so existence is checked first.
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
    } catch (error) {
      const code = failureCode(error);
      if (code === "not-found") {
        return infrastructureSuccess(false);
      }
      return infrastructureFailure("file-storage", code);
    }

    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
      return infrastructureSuccess(true);
    } catch (error) {
      return infrastructureFailure("file-storage", failureCode(error));
    }
  }
}
