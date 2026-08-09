"use server";

import { z } from "zod";

import type { CfpFormDefinition } from "@/lib/cfp";
import { validateCfpAnswers } from "@/lib/cfp";
import { CfpPublicAccessRepository } from "@/server/cfp/public-access";
import {
  CfpCategoryRepository,
  type CfpSubmissionParticipantInput,
  CfpSubmissionRepository,
} from "@/server/cfp/submissions";
import { getDatabaseClient } from "@/server/database/client";

export interface PublicCfpFormActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
  readonly submissionId?: string;
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

type SpeakerParseResult =
  | { readonly ok: true; readonly participants: readonly CfpSubmissionParticipantInput[] }
  | { readonly ok: false; readonly errors: Readonly<Record<string, readonly string[]>> };

function speakerValuesFromFormData(definition: CfpFormDefinition, formData: FormData): SpeakerParseResult {
  const speakerEntries = Array.from(formData.entries()).filter(([name]) => name.startsWith("speaker."));
  const minimum = definition.minimumSpeakerCount;
  const maximum = definition.maximumSpeakerCount;
  if (minimum === undefined || maximum === undefined) {
    return speakerEntries.length === 0
      ? { ok: true, participants: [] }
      : { ok: false, errors: { participants: ["Speaker fields are not enabled for this form."] } };
  }

  const requiredFields = new Set(definition.requiredSpeakerFields ?? []);
  const allowedFields = new Set(["email", "givenName", "familyName"]);
  if (requiredFields.has("contact")) allowedFields.add("phone");
  if (requiredFields.has("biography")) allowedFields.add("biography");
  if (requiredFields.has("consent")) allowedFields.add("consent");

  const rawParticipants = new Map<number, Record<string, FormDataEntryValue>>();
  const errors: Record<string, string[]> = {};
  for (const [name, value] of speakerEntries) {
    const match = /^speaker\.(\d+)\.([A-Za-z][A-Za-z0-9]*)$/.exec(name);
    if (!match) {
      errors.participants = ["The submitted speaker fields are invalid."];
      continue;
    }
    const index = Number(match[1]);
    const field = match[2];
    if (!allowedFields.has(field)) {
      errors[name] = ["This field is not present in the published form."];
      continue;
    }
    const participant = rawParticipants.get(index) ?? {};
    participant[field] = value;
    rawParticipants.set(index, participant);
  }

  const indexes = [...rawParticipants.keys()].sort((left, right) => left - right);
  if (indexes.some((index, position) => index !== position)) {
    errors.participants = ["The submitted speakers are out of sequence."];
  }
  if (indexes.length < minimum || indexes.length > maximum) {
    errors.participants = [`Add between ${minimum} and ${maximum} speakers.`];
  }

  const speakerSchema = z.object({
    givenName: z.string().trim().min(1, "Enter a first name."),
    familyName: z.string().trim().min(1, "Enter a last name."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email({ message: "Enter a valid email address." })),
    phone: requiredFields.has("contact")
      ? z.string().trim().min(1, "Enter a contact phone number.")
      : z.string().optional(),
    biography: requiredFields.has("biography") ? z.string().trim().min(1, "Enter a biography.") : z.string().optional(),
    consent: requiredFields.has("consent") ? z.literal("on", { error: "Consent is required." }) : z.string().optional(),
  });
  const participants: CfpSubmissionParticipantInput[] = [];
  for (const index of indexes) {
    const raw = rawParticipants.get(index) ?? {};
    const parsed = speakerSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "participant");
        const errorKey = `speaker.${index}.${field}`;
        errors[errorKey] = [...(errors[errorKey] ?? []), issue.message];
      }
      continue;
    }
    participants.push({
      email: parsed.data.email,
      givenName: parsed.data.givenName,
      familyName: parsed.data.familyName,
      ...(requiredFields.has("contact") ? { phone: parsed.data.phone } : {}),
      ...(requiredFields.has("biography") ? { biography: parsed.data.biography } : {}),
      ...(requiredFields.has("consent") ? { consent: true } : {}),
    });
  }
  const emails = participants.map(({ email }) => email);
  if (new Set(emails).size !== emails.length) {
    emails.forEach((email, index) => {
      if (emails.indexOf(email) !== index) errors[`speaker.${index}.email`] = ["Each speaker needs a unique email."];
    });
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, participants };
}

export async function submitPublicCfpForm(
  publicId: string,
  _previousState: PublicCfpFormActionState,
  formData: FormData,
): Promise<PublicCfpFormActionState> {
  const client = getDatabaseClient();
  const lookup = await new CfpPublicAccessRepository(client).findByPublicId(publicId);
  if (lookup.status !== "open") {
    return { status: "error", message: "This CFP is no longer accepting responses. Refresh the page to continue." };
  }
  const validation = validateCfpAnswers(lookup.form.definition, valuesFromFormData(lookup.form.definition, formData));
  const speakers = speakerValuesFromFormData(lookup.form.definition, formData);
  const consentErrors: Readonly<Record<string, readonly string[]>> =
    lookup.form.consentRequired && formData.get("consent") === null ? { consent: ["Consent is required."] } : {};
  if (!validation.ok || !speakers.ok || Object.keys(consentErrors).length > 0) {
    return {
      status: "error",
      message: "Review the form and fix the highlighted questions.",
      errors: {
        ...(validation.ok ? {} : validation.errors),
        ...(speakers.ok ? {} : speakers.errors),
        ...consentErrors,
      },
    };
  }

  try {
    const categories = await new CfpCategoryRepository(client).list(lookup.event.id);
    const categoryByKey = new Map(categories.map((category) => [category.key, category.id]));
    const categoryIds = validation.categoryKeys.flatMap((key) => {
      const categoryId = categoryByKey.get(key);
      return categoryId ? [categoryId] : [];
    });
    if (categoryIds.length !== validation.categoryKeys.length) {
      return { status: "error", message: "This CFP has an invalid category configuration. Contact the organizer." };
    }
    const submission = await new CfpSubmissionRepository(client).createDraft({
      eventId: lookup.event.id,
      formVersionId: lookup.form.versionId,
      kind: lookup.form.definition.submissionKind ?? "ABSTRACT",
      answers: validation.answers,
      categoryIds,
      participants: speakers.participants,
    });
    return {
      status: "success",
      message: "Your responses were saved.",
      submissionId: submission.id,
    };
  } catch {
    return { status: "error", message: "Your responses could not be saved. Try again." };
  }
}
