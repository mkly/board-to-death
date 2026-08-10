import "server-only";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { getDatabaseClient } from "@/server/database/client";
import { createFileStorage } from "@/server/infrastructure";

import { createPrismaFileRequestStore } from "./prisma-store";
import { FileRequestFileService } from "./request-files";

export function createFileRequestFileService(): FileRequestFileService {
  const database = getDatabaseClient();
  return new FileRequestFileService({
    storage: createFileStorage({ driver: "local", rootDirectory: getRuntimeConfig().server.FILE_STORAGE_PATH }),
    store: createPrismaFileRequestStore(database),
  });
}
