"use server";

import { notFound, redirect } from "next/navigation";

import { CfpAdminRole, CfpDraftPolicy } from "@/generated/prisma/client";
import { CfpAdministratorRepository, CfpPolicyRepository } from "@/server/cfp/policies";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { randomUUID } from "node:crypto";

export async function createCfpFormDraft(eventSlug: string): Promise<never> {
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event || shell.activeEvent?.id !== event.id) notFound();

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

  const administrator = await new CfpAdministratorRepository(client).upsert({
    eventId: event.id,
    externalId: shell.user.email,
    displayName: shell.user.name.trim() || shell.user.email,
  });
  const submissionClosesAt = new Date(event.startsAt.getTime() - 24 * 60 * 60 * 1_000);
  await new CfpPolicyRepository(client).create({
    eventId: event.id,
    key: created.key,
    definition: {
      submissionOpensAt: new Date(event.startsAt.getTime() - 180 * 24 * 60 * 60 * 1_000),
      submissionClosesAt,
      confirmationClosesAt: event.startsAt,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      submissionLimits: { maxSubmissionsPerSpeaker: 1, maxParticipantsPerSubmission: 1 },
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

  redirect(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp/forms/${created.formId}/setup`);
}
