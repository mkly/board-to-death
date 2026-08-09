"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { CfpPolicyStatus } from "@/generated/prisma/client";
import { CfpPolicyRepository } from "@/server/cfp/policies";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { randomUUID } from "node:crypto";

interface AuthorizedCfpEvent {
  readonly id: string;
  readonly slug: string;
  readonly administratorEmail: string;
}

async function requireAuthorizedEvent(eventSlug: string): Promise<AuthorizedCfpEvent> {
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event || shell.activeEvent?.id !== event.id) notFound();
  return { id: event.id, slug: event.slug, administratorEmail: shell.user.email };
}

function destination(eventSlug: string, result: { readonly notice?: string; readonly error?: string }): string {
  const search = new URLSearchParams();
  if (result.notice) search.set("notice", result.notice);
  if (result.error) search.set("error", result.error);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/cfp${suffix}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  console.error(error);
  return "The CFP form could not be updated. Try again.";
}

function refreshAndRedirect(eventSlug: string, notice: string): never {
  revalidatePath(destination(eventSlug, {}));
  redirect(destination(eventSlug, { notice }));
}

export async function createCfpFormDraft(eventSlug: string): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);

  const created = await new CfpFormRepository(getDatabaseClient()).create({
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

  redirect(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp/forms/${created.formId}/setup`);
}

export async function duplicateCfpForm(eventSlug: string, formId: string): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await new CfpFormRepository(getDatabaseClient()).duplicate(event.id, formId, `draft-${randomUUID()}`);
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(event.slug, "CFP form duplicated as a new draft.");
}

async function transitionCfpForm(
  eventSlug: string,
  formId: string,
  status: CfpPolicyStatus,
  notice: string,
): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await new CfpPolicyRepository(getDatabaseClient()).transitionByForm(
      event.id,
      formId,
      status,
      event.administratorEmail,
    );
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(event.slug, notice);
}

export async function closeCfpForm(eventSlug: string, formId: string): Promise<never> {
  return transitionCfpForm(eventSlug, formId, CfpPolicyStatus.CLOSED, "CFP form closed.");
}

export async function reopenCfpForm(eventSlug: string, formId: string): Promise<never> {
  return transitionCfpForm(eventSlug, formId, CfpPolicyStatus.PUBLISHED, "CFP form reopened.");
}

export async function archiveCfpForm(eventSlug: string, formId: string): Promise<never> {
  return transitionCfpForm(eventSlug, formId, CfpPolicyStatus.ARCHIVED, "CFP form archived.");
}
