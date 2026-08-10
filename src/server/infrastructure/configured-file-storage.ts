import "server-only";

import { getRuntimeConfig } from "@/config/runtime-env.server";

import type { FileStorageService } from "./contracts.ts";
import { createFileStorage } from "./file-storage.ts";

let configuredStorage: FileStorageService | undefined;

/**
 * The file storage the runtime configuration selects: S3 in production, the
 * local-disk driver in development and test. Cached so every request shares
 * one S3 client and its connection pool instead of constructing a new one.
 */
export function getConfiguredFileStorage(): FileStorageService {
  configuredStorage ??= createConfiguredFileStorage();
  return configuredStorage;
}

function createConfiguredFileStorage(): FileStorageService {
  const server = getRuntimeConfig().server;

  if (server.FILE_STORAGE_DRIVER === "s3") {
    if (!server.FILE_STORAGE_S3_BUCKET || !server.FILE_STORAGE_S3_REGION) {
      throw new Error("FILE_STORAGE_S3_BUCKET and FILE_STORAGE_S3_REGION are required when FILE_STORAGE_DRIVER=s3");
    }
    return createFileStorage({
      driver: "s3",
      bucket: server.FILE_STORAGE_S3_BUCKET,
      region: server.FILE_STORAGE_S3_REGION,
      endpoint: server.FILE_STORAGE_S3_ENDPOINT,
      forcePathStyle:
        server.FILE_STORAGE_S3_FORCE_PATH_STYLE === undefined
          ? undefined
          : server.FILE_STORAGE_S3_FORCE_PATH_STYLE === "true",
    });
  }

  if (!server.FILE_STORAGE_PATH) {
    throw new Error("FILE_STORAGE_PATH is required when FILE_STORAGE_DRIVER=local");
  }
  return createFileStorage({ driver: "local", rootDirectory: server.FILE_STORAGE_PATH });
}
