import "server-only";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { createFileStorage, SpeakerFileService } from "@/server/infrastructure";

export function createSpeakerFileService(): SpeakerFileService {
  return new SpeakerFileService({
    storage: createFileStorage({ driver: "local", rootDirectory: getRuntimeConfig().server.FILE_STORAGE_PATH }),
  });
}
