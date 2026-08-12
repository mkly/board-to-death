"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { CfpAdminRole, CfpDraftPolicy, CfpPolicyStatus } from "@/generated/prisma/client";
import { CfpAdministratorRepository, CfpPolicyRepository } from "@/server/cfp/policies";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { randomUUID } from "node:crypto";

interface AuthorizedCfpEvent {
  readonly id: string;
  readonly slug: string;
  readonly startsAt: Date;
  readonly administratorId: string;
  readonly administratorName: string;
}

async function requireAuthorizedEvent(eventSlug: string): Promise<AuthorizedCfpEvent> {
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event || shell.activeEvent?.id !== event.id) notFound();
  return {
    id: event.id,
    slug: event.slug,
    startsAt: event.startsAt,
    administratorId: shell.user.id,
    administratorName: shell.user.name.trim() || shell.user.email,
  };
}

export interface CfpActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

function cfpPath(eventSlug: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/cfp`;
}

function errorMessage(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  console.error(error);
  return "The CFP form could not be updated. Try again.";
}

function succeed(eventSlug: string, message: string): CfpActionState {
  revalidatePath(cfpPath(eventSlug));
  return { status: "success", message };
}

export async function createCfpFormDraft(eventSlug: string): Promise<CfpActionState> {
  const event = await requireAuthorizedEvent(eventSlug);

  const client = getDatabaseClient();
  const created = await new CfpFormRepository(client).create({
    eventId: event.id,
    key: `draft-${randomUUID()}`,
    definition: {
      version: 1,
      title: "Untitled CFP",
      description: "Configure this form before publishing it to prospective speakers.",
      submissionKind: "ABSTRACT",
      accessPolicy: "OPEN",
      welcomeTitle: "Submit your session",
      welcomeContent: "Share your idea with our program team.",
      instructions: "Complete each required field before submitting your proposal.",
      termsContent: "",
      consentRequired: false,
      sections: [
        {
          id: "proposal",
          kind: "questions",
          title: "Proposal",
          questions: [],
        },
      ],
    },
  });

  try {
    const administrator = await new CfpAdministratorRepository(client).ensure({
      eventId: event.id,
      externalId: event.administratorId,
      displayName: event.administratorName,
    });
    await new CfpPolicyRepository(client).create({
      eventId: event.id,
      key: created.key,
      definition: {
        submissionOpensAt: new Date(event.startsAt.getTime() - 180 * 24 * 60 * 60 * 1_000),
        submissionClosesAt: new Date(event.startsAt.getTime() - 24 * 60 * 60 * 1_000),
        confirmationClosesAt: event.startsAt,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        submissionLimits: { maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 },
        messages: {
          introduction: created.definition.welcomeContent ?? "Share your proposal with our program team.",
          submissionConfirmation: "Your submission has been received.",
          closed: "This call for proposals is closed.",
        },
        conditionalVisibility: [],
        categoryRouting: [],
        adminAssignments: [
          {
            administratorId: administrator.id,
            role: CfpAdminRole.OWNER,
            notifyOnNewSubmission: false,
            notifyOnSubmissionUpdate: false,
          },
        ],
      },
    });
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }

  redirect(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp/forms/${created.formId}/setup`);
}

export async function duplicateCfpForm(eventSlug: string, formId: string): Promise<CfpActionState> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await new CfpFormRepository(getDatabaseClient()).duplicate(event.id, formId, `draft-${randomUUID()}`);
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
  return succeed(event.slug, "CFP form duplicated as a new draft.");
}

async function transitionCfpForm(
  eventSlug: string,
  formId: string,
  status: CfpPolicyStatus,
  notice: string,
): Promise<CfpActionState> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await new CfpPolicyRepository(getDatabaseClient()).transitionByForm(
      event.id,
      formId,
      status,
      event.administratorId,
    );
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
  return succeed(event.slug, notice);
}

export async function closeCfpForm(eventSlug: string, formId: string): Promise<CfpActionState> {
  return transitionCfpForm(eventSlug, formId, CfpPolicyStatus.CLOSED, "CFP form closed.");
}

export async function reopenCfpForm(eventSlug: string, formId: string): Promise<CfpActionState> {
  return transitionCfpForm(eventSlug, formId, CfpPolicyStatus.PUBLISHED, "CFP form reopened.");
}

export async function archiveCfpForm(eventSlug: string, formId: string): Promise<CfpActionState> {
  return transitionCfpForm(eventSlug, formId, CfpPolicyStatus.ARCHIVED, "CFP form archived.");
}
