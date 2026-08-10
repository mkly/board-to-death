"use server";

import { revalidatePath } from "next/cache";

import { CustomFieldEntityType, CustomFieldType } from "@/generated/prisma/client";
import type { CfpFormDefinition } from "@/lib/cfp";
import { validateCfpAnswers } from "@/lib/cfp";
import { CfpCategoryRepository, CfpSubmissionRepository } from "@/server/cfp/submissions";
import { parseCustomFieldFormData } from "@/server/custom-fields/form-values";
import { CustomFieldRepository, validateCustomFieldValue } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";
import { validateFileUpload } from "@/server/speakers/file-policy";
import type { UpdateSubmissionParticipantFilesInput } from "@/server/speakers/repositories";
import { SpeakerRepository } from "@/server/speakers/repositories";
import { createSpeakerFileService } from "@/server/speakers/speaker-file-storage";

import { portalHref, requirePortalContent } from "../../../_lib/portal-session";

export type SubmissionFilePurpose = "slides" | "supportingDocument";

export interface SubmissionFileActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

export interface SubmissionCustomFieldActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

export interface ApplicantSubmissionActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

function valuesFromFormData(definition: CfpFormDefinition, formData: FormData): Record<string, unknown> {
  const questions = definition.sections.flatMap((section) => section.questions);
  const values: Record<string, unknown> = {};
  for (const question of questions) {
    const name = `answer.${question.id}`;
    if (question.type === "checkbox") values[question.id] = formData.get(name) !== null;
    else if (question.type === "multi_select") values[question.id] = formData.getAll(name);
    else values[question.id] = formData.get(name) ?? undefined;
  }
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("answer.")) values[name.slice("answer.".length)] ??= value;
  }
  return values;
}

export async function updateApplicantSubmission(
  eventSlug: string,
  submissionId: string,
  _previousState: ApplicantSubmissionActionState,
  formData: FormData,
): Promise<ApplicantSubmissionActionState> {
  const { viewer } = await requirePortalContent(eventSlug, "submissions");
  const client = getDatabaseClient();
  const submission = await new SpeakerPortalRepository(client).getSubmission(viewer, submissionId);
  if (!submission) return { status: "error", message: "You are not a participant on this submission." };
  if (!submission.canEdit || !submission.definition) {
    return { status: "error", message: "This call for proposals is closed. Your submitted proposal is read-only." };
  }

  const validation = validateCfpAnswers(submission.definition, valuesFromFormData(submission.definition, formData));
  if (!validation.ok) {
    return { status: "error", message: "Review the highlighted responses.", errors: validation.errors };
  }
  const categories = await new CfpCategoryRepository(client).list(viewer.eventId);
  const categoryByKey = new Map(categories.map((category) => [category.key, category.id]));
  const categoryIds = validation.categoryKeys.flatMap((key) => {
    const categoryId = categoryByKey.get(key);
    return categoryId ? [categoryId] : [];
  });
  if (categoryIds.length !== validation.categoryKeys.length) {
    return { status: "error", message: "This proposal has an invalid category configuration. Contact the organizer." };
  }

  try {
    await new CfpSubmissionRepository(client).updateByApplicant(viewer.eventId, submissionId, {
      speakerId: viewer.speakerId,
      answers: validation.answers,
      categoryIds,
    });
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
  revalidatePath(portalHref(eventSlug, `/submissions/${submissionId}`));
  return { status: "success", message: "Your proposal changes were saved." };
}

export async function saveSubmissionCustomFields(
  eventSlug: string,
  submissionId: string,
  _previousState: SubmissionCustomFieldActionState,
  formData: FormData,
): Promise<SubmissionCustomFieldActionState> {
  const { viewer } = await requirePortalContent(eventSlug, "submissions");
  const client = getDatabaseClient();
  const submission = await new SpeakerPortalRepository(client).getSubmission(viewer, submissionId);
  if (!submission) return { status: "error", message: "You are not a participant on this submission." };

  const repository = new CustomFieldRepository(client);
  const definitions = (await repository.listDefinitions(viewer.eventId, CustomFieldEntityType.CFP_SUBMISSION)).filter(
    ({ type }) => type !== CustomFieldType.FILE,
  );
  let parsed: ReturnType<typeof parseCustomFieldFormData>;
  try {
    parsed = parseCustomFieldFormData(formData, definitions);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The custom fields are invalid." };
  }
  const errors: Record<string, readonly string[]> = {};
  for (const entry of parsed.values) {
    try {
      validateCustomFieldValue(entry.definition, entry.value);
    } catch (error) {
      errors[entry.definition.id] = [error instanceof Error ? error.message : "This custom field is invalid."];
    }
  }
  if (Object.keys(errors).length > 0) {
    return { status: "error", message: "Review the highlighted custom fields.", errors };
  }

  try {
    await repository.setValues(
      viewer.eventId,
      { entityType: "CFP_SUBMISSION", submissionId },
      parsed.values.map(({ definition, value }) => ({ definitionId: definition.id, value })),
    );
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
  revalidatePath(portalHref(eventSlug, `/submissions/${submissionId}`));
  return { status: "success", message: "Additional information updated." };
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
  const { viewer } = await requirePortalContent(eventSlug, "files");
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
  const { viewer } = await requirePortalContent(eventSlug, "files");
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
