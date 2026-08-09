"use server";

import { cookies } from "next/headers";

import { z } from "zod";

import { portalHref, SPEAKER_SESSION_COOKIE } from "@/app/(speaker)/portal/[eventSlug]/_lib/portal-session";
import { getRuntimeConfig } from "@/config/runtime-env.server";
import { CfpDraftPolicy } from "@/generated/prisma/client";
import type { CfpFormDefinition } from "@/lib/cfp";
import { validateCfpAnswers } from "@/lib/cfp";
import { CfpDraftRepository } from "@/server/cfp/drafts";
import { CfpPublicAccessRepository } from "@/server/cfp/public-access";
import {
  CfpCategoryRepository,
  type CfpSubmissionParticipantInput,
  CfpSubmissionRepository,
} from "@/server/cfp/submissions";
import { type CfpApplicantRecipient, CfpThankYouRepository, renderCfpApplicantMessage } from "@/server/cfp/thank-you";
import { getDatabaseClient } from "@/server/database/client";
import { emitWebhookEvent } from "@/server/developer-api/webhooks";
import { RepositoryError } from "@/server/events/repositories";
import { SpeakerAuthService } from "@/server/speaker-auth";

export interface PublicCfpFormActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
  readonly submissionId?: string;
  readonly confirmationMarkdown?: string;
  readonly portalHref?: string;
  readonly autoRedirectDelaySeconds?: number;
}

export interface SaveCfpDraftActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
  readonly token?: string;
  readonly expiresAt?: string;
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

function rawParticipantsFromFormData(formData: FormData): readonly Record<string, string>[] {
  const raw = new Map<number, Record<string, string>>();
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const match = /^speaker\.(\d+)\.([A-Za-z][A-Za-z0-9]*)$/.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    const participant = raw.get(index) ?? {};
    participant[match[2]] = value;
    raw.set(index, participant);
  }
  return [...raw.keys()]
    .sort((left, right) => left - right)
    .map((index) => raw.get(index))
    .filter((participant) => participant !== undefined);
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
  const participantIndexes: number[] = [];
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
    participantIndexes.push(index);
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
    emails.forEach((email, position) => {
      if (emails.indexOf(email) !== position) {
        errors[`speaker.${participantIndexes[position]}.email`] = ["Each speaker needs a unique email."];
      }
    });
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, participants };
}

function applicantRecipient(
  definition: CfpFormDefinition,
  answers: readonly { readonly questionId: string; readonly value: unknown }[],
  participants: readonly CfpSubmissionParticipantInput[],
): CfpApplicantRecipient | null {
  const lead = participants[0];
  if (lead) return { email: lead.email, name: `${lead.givenName} ${lead.familyName}` };

  const answersByQuestion = new Map(answers.map(({ questionId, value }) => [questionId, value]));
  for (const question of definition.sections.flatMap((section) => section.questions)) {
    if (question.type !== "email") continue;
    const email = answersByQuestion.get(question.id);
    if (typeof email === "string" && email.trim() !== "") return { email, name: email };
  }
  return null;
}

export async function submitPublicCfpForm(
  publicId: string,
  _previousState: PublicCfpFormActionState,
  formData: FormData,
): Promise<PublicCfpFormActionState> {
  const idempotencyKey = z.uuid().safeParse(formData.get("submissionKey"));
  if (!idempotencyKey.success) {
    return { status: "error", message: "This submission request is invalid. Refresh the page and try again." };
  }
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
    const recipient = applicantRecipient(lookup.form.definition, validation.answers, speakers.participants);
    if (!recipient) {
      return { status: "error", message: "This CFP has no applicant email field. Contact the organizer." };
    }
    const messageContext = { event: lookup.event, recipient };
    const confirmation = renderCfpApplicantMessage(lookup.policy.messages.submissionConfirmation, messageContext);
    const submission = await new CfpSubmissionRepository(client).createFinalized({
      eventId: lookup.event.id,
      formVersionId: lookup.form.versionId,
      kind: lookup.form.definition.submissionKind ?? "ABSTRACT",
      idempotencyKey: idempotencyKey.data,
      answers: validation.answers,
      categoryIds,
      participants: speakers.participants,
    });
    await emitWebhookEvent(client, {
      eventId: lookup.event.id,
      type: "submission.created",
      data: { submissionId: submission.id, status: submission.status, kind: submission.kind },
    });
    const runtimeConfig = getRuntimeConfig();
    const speakerPortalHref = portalHref(lookup.event.slug);
    const portalSignInUrl = new URL(
      portalHref(lookup.event.slug, "/sign-in"),
      runtimeConfig.public.NEXT_PUBLIC_APP_URL,
    ).toString();
    await new CfpThankYouRepository(client).queue({
      ...messageContext,
      policyId: lookup.policy.id,
      policyVersionNumber: lookup.policy.versionNumber,
      submissionId: submission.id,
      bodyTemplate: lookup.policy.messages.thankYou ?? lookup.policy.messages.submissionConfirmation,
      portalUrl: portalSignInUrl,
    });

    const leadParticipant = await client.cfpSubmissionParticipant.findFirst({
      where: { eventId: lookup.event.id, submissionId: submission.id },
      orderBy: { sortOrder: "asc" },
      select: { speakerId: true },
    });
    // This form is public and unauthenticated, so the submitted address is unverified. Handing an
    // automatic session to a speaker who already existed would let anyone take over that speaker's
    // portal — and rotating the session would sign the real speaker out — simply by typing their
    // address. A speaker this submission just created carries no prior data, so only that case gets
    // a session; everyone else continues through the emailed sign-in link.
    const leadIsNewSpeaker =
      leadParticipant !== null &&
      (await client.speakerProfileVersion.count({ where: { speakerId: leadParticipant.speakerId } })) === 1;
    if (leadParticipant && leadIsNewSpeaker) {
      const session = await new SpeakerAuthService({ database: client }).issueSession({
        eventId: lookup.event.id,
        speakerId: leadParticipant.speakerId,
      });
      (await cookies()).set(SPEAKER_SESSION_COOKIE, session.sessionToken, {
        expires: session.expiresAt,
        httpOnly: true,
        path: "/portal",
        sameSite: "lax",
        secure: new URL(runtimeConfig.public.NEXT_PUBLIC_APP_URL).protocol === "https:",
      });
    }

    const draftToken = formData.get("draftToken");
    if (typeof draftToken === "string" && draftToken.trim() !== "") {
      await new CfpDraftRepository({ database: client })
        .discard({ eventId: lookup.event.id, policyId: lookup.policyId, token: draftToken })
        .catch(() => undefined);
    }

    return {
      status: "success",
      message: "Your proposal was submitted.",
      submissionId: submission.id,
      confirmationMarkdown: confirmation.previewMarkdown,
      ...(leadParticipant
        ? {
            portalHref: speakerPortalHref,
            // Without a session the portal bounces to sign-in, so only count down when the redirect
            // actually lands the applicant in their portal.
            ...(leadIsNewSpeaker && lookup.policy.messages.portalHandoff?.autoRedirect
              ? { autoRedirectDelaySeconds: lookup.policy.messages.portalHandoff.redirectDelaySeconds }
              : {}),
          }
        : {}),
    };
  } catch (error) {
    if (error instanceof RepositoryError) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: "Your proposal could not be submitted. Try again." };
  }
}

export async function saveCfpDraft(
  publicId: string,
  _previousState: SaveCfpDraftActionState,
  formData: FormData,
): Promise<SaveCfpDraftActionState> {
  const client = getDatabaseClient();
  const lookup = await new CfpPublicAccessRepository(client).findByPublicId(publicId);
  if (lookup.status !== "open") {
    return { status: "error", message: "This CFP is no longer accepting responses. Refresh the page to continue." };
  }
  if (lookup.draftPolicy === CfpDraftPolicy.DISABLED) {
    return { status: "error", message: "Drafts are not enabled for this form." };
  }

  const answers = valuesFromFormData(lookup.form.definition, formData);
  const participants = rawParticipantsFromFormData(formData);
  const existingToken = formData.get("draftToken");
  const token = typeof existingToken === "string" && existingToken.trim() !== "" ? existingToken : undefined;

  try {
    const draft = await new CfpDraftRepository({ database: client }).save({
      eventId: lookup.event.id,
      policyId: lookup.policyId,
      draftPolicy: lookup.draftPolicy,
      formVersionId: lookup.form.versionId,
      answers,
      participants,
      categoryKeys: [],
      token,
    });
    return {
      status: "success",
      message: "Your draft was saved. Use the link below to resume it later.",
      token: draft.token,
      expiresAt: draft.expiresAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof RepositoryError) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: "Your draft could not be saved. Try again." };
  }
}
