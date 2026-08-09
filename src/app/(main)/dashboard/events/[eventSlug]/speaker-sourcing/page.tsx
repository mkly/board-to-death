import { notFound } from "next/navigation";

import { searchDirectoryPeople } from "@/server/contacts/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerSourcingRepository } from "@/server/speaker-sourcing/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { SpeakerSourcingWorkspace } from "./_components/speaker-sourcing-workspace";

interface SpeakerSourcingPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ notice?: string; error?: string }>;
}

export default async function SpeakerSourcingPage({ params, searchParams }: SpeakerSourcingPageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const repository = new SpeakerSourcingRepository(client);
  const [stages, forms, people] = await Promise.all([
    repository.listBoard(event.id),
    repository.listInterestForms(event.id),
    searchDirectoryPeople(client, ""),
  ]);
  const enrolledPersonIds = new Set(stages.flatMap(({ prospects }) => prospects.map(({ personId }) => personId)));

  return (
    <SpeakerSourcingWorkspace
      availablePeople={people.filter(({ id }) => !enrolledPersonIds.has(id))}
      error={query.error}
      event={{ id: event.id, name: event.name, slug: event.slug }}
      forms={forms}
      notice={query.notice}
      stages={stages}
    />
  );
}
