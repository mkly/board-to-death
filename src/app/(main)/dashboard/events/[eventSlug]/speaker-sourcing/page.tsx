import { notFound } from "next/navigation";

import { searchDirectoryPeople } from "@/server/contacts/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerSourcingRepository } from "@/server/speaker-sourcing/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { SpeakerSourcingWorkspace } from "./_components/speaker-sourcing-workspace";

interface SpeakerSourcingPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

export default async function SpeakerSourcingPage({ params }: SpeakerSourcingPageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const repository = new SpeakerSourcingRepository(client);
  const [stages, forms, people] = await Promise.all([
    repository.listBoard(event.id),
    repository.listInterestForms(event.id),
    searchDirectoryPeople(client, event.id, ""),
  ]);
  const enrolledPersonIds = new Set(stages.flatMap(({ prospects }) => prospects.map(({ personId }) => personId)));

  return (
    <SpeakerSourcingWorkspace
      availablePeople={people.filter(({ id }) => !enrolledPersonIds.has(id))}
      event={{ id: event.id, name: event.name, slug: event.slug }}
      forms={forms}
      stages={stages}
    />
  );
}
