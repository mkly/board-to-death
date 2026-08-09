"use server";

import { revalidatePath } from "next/cache";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import type { Prisma } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { createFileStorage, SpeakerFileService } from "@/server/infrastructure";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";
import { SpeakerOnboardingRepository, speakerTaskResponseKind } from "@/server/speakers";

import { getPortalViewer, portalHref } from "../../../_lib/portal-session";

const MAX_RESPONSE_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_RESPONSE_FILE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"]);

export interface TaskSubmissionState {
  readonly message: string;
  readonly status: "error" | "idle" | "success";
}

function speakerFiles(): SpeakerFileService {
  return new SpeakerFileService({
    storage: createFileStorage({
      driver: "local",
      rootDirectory: getRuntimeConfig().server.FILE_STORAGE_PATH,
    }),
  });
}

function failure(error: unknown): TaskSubmissionState {
  if (error instanceof RepositoryError) return { status: "error", message: error.message };
  console.error(error);
  return { status: "error", message: "The task could not be submitted. Try again." };
}

export async function submitSpeakerTask(
  eventSlug: string,
  assignmentId: string,
  _previousState: TaskSubmissionState,
  formData: FormData,
): Promise<TaskSubmissionState> {
  let uploadedKey: string | undefined;
  try {
    const viewer = await getPortalViewer(eventSlug);
    const database = getDatabaseClient();
    const portal = new SpeakerPortalRepository(database);
    const task = await portal.getTask(viewer, assignmentId);
    if (!task) throw new RepositoryError("not-found", "The speaker task was not found.");
    if (task.status === "SUBMITTED") return { status: "success", message: "This task is already submitted." };

    const kind = speakerTaskResponseKind(
      task.definitionVersion.responseRequired,
      task.definitionVersion.responseSchema,
    );
    let response: Prisma.InputJsonValue | undefined;
    if (kind === "TEXT") {
      const value = formData.get("response");
      response = typeof value === "string" ? value : "";
    } else if (kind === "CONFIRMATION") {
      response = { approved: formData.get("approved") === "on" };
    } else if (kind === "FILE") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        throw new RepositoryError("invalid-input", "Choose a file before submitting.");
      }
      if (file.size > MAX_RESPONSE_FILE_BYTES) {
        throw new RepositoryError("invalid-input", "The response file must be 5 MB or smaller.");
      }
      if (!ALLOWED_RESPONSE_FILE_TYPES.has(file.type)) {
        throw new RepositoryError("invalid-input", "Upload a PDF, text file, JPEG, PNG, or WebP file.");
      }
      const files = speakerFiles();
      const uploaded = await files.write({
        eventId: viewer.eventId,
        speakerId: viewer.speakerId,
        fileName: file.name,
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (!uploaded.ok) throw new RepositoryError("invalid-input", "The response file could not be stored.");
      uploadedKey = uploaded.value.key;
      response = {
        objectKey: uploaded.value.key,
        fileName: uploaded.value.fileName,
        contentType: uploaded.value.contentType,
        size: uploaded.value.size,
      };
    }

    await new SpeakerOnboardingRepository(database).submit(viewer.eventId, assignmentId, response, viewer.speakerId);
    revalidatePath(portalHref(eventSlug));
    revalidatePath(portalHref(eventSlug, `/tasks/${assignmentId}`));
    revalidatePath(`/dashboard/events/${eventSlug}/onboarding`);
    return { status: "success", message: "Task submitted for review." };
  } catch (error) {
    if (uploadedKey) {
      const viewer = await getPortalViewer(eventSlug).catch(() => null);
      if (viewer) {
        await speakerFiles()
          .remove(uploadedKey, { role: "speaker", ...viewer })
          .catch(() => undefined);
      }
    }
    return failure(error);
  }
}
