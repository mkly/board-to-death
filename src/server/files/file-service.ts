import { getConfiguredFileStorage } from "@/server/infrastructure/configured-file-storage";
import "server-only";

import { getDatabaseClient } from "@/server/database/client";

import { createPrismaFileRequestStore } from "./prisma-store";
import { FileRequestFileService } from "./request-files";

export function createFileRequestFileService(): FileRequestFileService {
  const database = getDatabaseClient();
  return new FileRequestFileService({
    storage: getConfiguredFileStorage(),
    store: createPrismaFileRequestStore(database),
  });
}
