"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { validateFileUpload } from "@/server/speakers/file-policy";
import type { UpdateSubmissionParticipantFilesInput } from "@/server/speakers/repositories";
import { SpeakerRepository } from "@/server/speakers/repositories";
import { createSpeakerFileService } from "@/server/speakers/speaker-file-storage";

import { getPortalViewer, portalHref } from "../../../_lib/portal-session";

export type SubmissionFilePurpose = "slides" | "supportingDocument";

export interface SubmissionFileActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

function participantFileKey(
  participant: { readonly slidesObjectKey: string | null; readonly supportingDocumentObjectKey: string | null },
  purpose: SubmissionFilePurpose,
): string | null {
  return purpose === "slides" ? participant.slidesObjectKey : participant.supportingDocumentObjectKey;
}

function participantFileUpdate(
  purpose: SubmissionFilePurpose,
  key: string | null,
): UpdateSubmissionParticipantFilesInput {
  return purpose === "slides" ? { slidesObjectKey: key } : { supportingDocumentObjectKey: key };
}

export async function uploadSubmissionFile(
  eventSlug: string,
  submissionId: string,
  purpose: SubmissionFilePurpose,
  _previousState: SubmissionFileActionState,
  formData: FormData,
): Promise<SubmissionFileActionState> {
  const viewer = await getPortalViewer(eventSlug);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file to upload." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateFileUpload(purpose, file.type, bytes);
  if (!validation.ok) {
    return { status: "error", message: validation.message };
  }

  const repository = new SpeakerRepository(getDatabaseClient());
  const participant = await repository.getSubmissionParticipant(viewer.eventId, submissionId, viewer.speakerId);
  if (!participant) {
    return { status: "error", message: "You are not a participant on this submission." };
  }
  const currentKey = participantFileKey(participant, purpose);

  const fileService = createSpeakerFileService();
  const principal = { role: "speaker" as const, ...viewer };
  const write = {
    eventId: viewer.eventId,
    speakerId: viewer.speakerId,
    fileName: file.name,
    contentType: file.type,
    bytes,
  };
  const stored = currentKey ? await fileService.replace(currentKey, write, principal) : await fileService.write(write);
  if (!stored.ok) {
    return { status: "error", message: "The file could not be saved. Try again." };
  }

  try {
    await repository.updateSubmissionParticipantFiles(
      viewer.eventId,
      submissionId,
      viewer.speakerId,
      participantFileUpdate(purpose, stored.value.key),
    );
  } catch (error) {
    if (error instanceof RepositoryError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }

  revalidatePath(portalHref(eventSlug, `/submissions/${submissionId}`));
  return { status: "success", message: purpose === "slides" ? "Slides updated." : "Supporting document updated." };
}

export async function removeSubmissionFile(
  eventSlug: string,
  submissionId: string,
  purpose: SubmissionFilePurpose,
  _previousState: SubmissionFileActionState,
  _formData: FormData,
): Promise<SubmissionFileActionState> {
  const viewer = await getPortalViewer(eventSlug);
  const repository = new SpeakerRepository(getDatabaseClient());
  const participant = await repository.getSubmissionParticipant(viewer.eventId, submissionId, viewer.speakerId);
  if (!participant) {
    return { status: "error", message: "You are not a participant on this submission." };
  }
  const currentKey = participantFileKey(participant, purpose);
  if (!currentKey) {
    return { status: "error", message: "There is nothing to remove." };
  }

  const removed = await createSpeakerFileService().remove(currentKey, { role: "speaker", ...viewer });
  if (!removed.ok) {
    return { status: "error", message: "The file could not be removed. Try again." };
  }

  try {
    await repository.updateSubmissionParticipantFiles(
      viewer.eventId,
      submissionId,
      viewer.speakerId,
      participantFileUpdate(purpose, null),
    );
  } catch (error) {
    if (error instanceof RepositoryError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }

  revalidatePath(portalHref(eventSlug, `/submissions/${submissionId}`));
  return { status: "success", message: purpose === "slides" ? "Slides removed." : "Supporting document removed." };
}
