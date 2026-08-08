import type { FileStorageService, FileWrite, InfrastructureResult, StoredFile } from "./contracts.ts";
import { InMemoryFileStorage } from "./fakes.ts";
import { isSafeObjectKey } from "./object-key.ts";
import { captureInfrastructureResult, infrastructureFailure, infrastructureSuccess } from "./results.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface PersistedFile {
  readonly version: 1;
  readonly key: string;
  readonly contentType: string;
  readonly contentDisposition?: string;
  readonly etag: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly bytes: string;
}

export interface LocalFileStorageOptions {
  readonly rootDirectory: string;
}

export type FileStorageOptions =
  | { readonly driver: "memory" }
  | { readonly driver: "local"; readonly rootDirectory: string };

function objectFileName(key: string): string {
  return `${createHash("sha256").update(key).digest("hex")}.json`;
}

function validWrite(file: FileWrite): boolean {
  return isSafeObjectKey(file.key) && file.contentType.trim().length > 0;
}

export class LocalFileStorage implements FileStorageService {
  readonly #rootDirectory: string;

  constructor(options: LocalFileStorageOptions) {
    if (options.rootDirectory.trim() === "") {
      throw new TypeError("Local file storage requires a root directory.");
    }
    this.#rootDirectory = resolve(options.rootDirectory);
  }

  async put(file: FileWrite): Promise<InfrastructureResult<StoredFile["metadata"]>> {
    if (!validWrite(file)) {
      return infrastructureFailure("file-storage", "invalid-input");
    }

    return captureInfrastructureResult("file-storage", async () => {
      await mkdir(this.#rootDirectory, { recursive: true, mode: 0o700 });
      const etag = createHash("sha256").update(file.bytes).digest("hex");
      const persisted: PersistedFile = {
        version: 1,
        key: file.key,
        contentType: file.contentType,
        contentDisposition: file.contentDisposition,
        etag,
        metadata: { ...file.metadata },
        bytes: Buffer.from(file.bytes).toString("base64"),
      };
      const destination = resolve(this.#rootDirectory, objectFileName(file.key));
      const temporary = `${destination}.${randomUUID()}.tmp`;

      try {
        await writeFile(temporary, JSON.stringify(persisted), { encoding: "utf8", mode: 0o600, flag: "wx" });
        await rename(temporary, destination);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }

      return {
        key: file.key,
        contentType: file.contentType,
        size: file.bytes.byteLength,
        etag,
        contentDisposition: file.contentDisposition,
        metadata: { ...file.metadata },
      };
    });
  }

  async get(key: string): Promise<InfrastructureResult<StoredFile>> {
    if (!isSafeObjectKey(key)) {
      return infrastructureFailure("file-storage", "invalid-input");
    }

    try {
      const serialized = await readFile(resolve(this.#rootDirectory, objectFileName(key)), "utf8");
      const persisted = JSON.parse(serialized) as PersistedFile;
      if (persisted.version !== 1 || persisted.key !== key || typeof persisted.bytes !== "string") {
        return infrastructureFailure("file-storage", "unexpected");
      }
      const bytes = Uint8Array.from(Buffer.from(persisted.bytes, "base64"));

      return infrastructureSuccess({
        metadata: {
          key,
          contentType: persisted.contentType,
          size: bytes.byteLength,
          etag: persisted.etag,
          contentDisposition: persisted.contentDisposition,
          metadata: { ...persisted.metadata },
        },
        bytes,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return infrastructureFailure("file-storage", "not-found");
      }
      return infrastructureFailure("file-storage", "unexpected");
    }
  }

  async delete(key: string): Promise<InfrastructureResult<boolean>> {
    if (!isSafeObjectKey(key)) {
      return infrastructureFailure("file-storage", "invalid-input");
    }

    try {
      await rm(resolve(this.#rootDirectory, objectFileName(key)));
      return infrastructureSuccess(true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return infrastructureSuccess(false);
      }
      return infrastructureFailure("file-storage", "unexpected");
    }
  }
}

export function createFileStorage(options: FileStorageOptions): FileStorageService {
  return options.driver === "memory"
    ? new InMemoryFileStorage()
    : new LocalFileStorage({ rootDirectory: options.rootDirectory });
}
