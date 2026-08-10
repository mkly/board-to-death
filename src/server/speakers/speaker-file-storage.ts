import { getConfiguredFileStorage } from "@/server/infrastructure/configured-file-storage";
import "server-only";

import { SpeakerFileService } from "@/server/infrastructure";

export function createSpeakerFileService(): SpeakerFileService {
  return new SpeakerFileService({
    storage: getConfiguredFileStorage(),
  });
}
