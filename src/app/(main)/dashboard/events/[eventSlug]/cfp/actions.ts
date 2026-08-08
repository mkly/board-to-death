"use server";

import { notFound, redirect } from "next/navigation";

import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { randomUUID } from "node:crypto";

export async function createCfpFormDraft(eventSlug: string): Promise<never> {
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event || shell.activeEvent?.id !== event.id) notFound();

  const created = await new CfpFormRepository(getDatabaseClient()).create({
    eventId: event.id,
    key: `draft-${randomUUID()}`,
    definition: {
      version: 1,
      title: "Untitled CFP",
      description: "Configure this form before publishing it to prospective speakers.",
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
