import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { AdminIntakeRepository } from "@/server/intake/admin-intake";
import { SpeakerRepository } from "@/server/speakers/repositories";

import { getDashboardShellData } from "../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../_lib/dashboard-shell";
import { IntakeWorkspace } from "./_components/intake-workspace";

interface IntakePageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

export default async function IntakePage({ params }: IntakePageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const [forms, speakers, tracks, categories] = await Promise.all([
    new AdminIntakeRepository(client).listForms(event.id),
    new SpeakerRepository(client).list(event.id),
    client.track.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    client.cfpCategory.findMany({ where: { eventId: event.id }, orderBy: [{ label: "asc" }, { key: "asc" }] }),
  ]);

  return (
    <IntakeWorkspace
      categories={categories.map(({ id, label }) => ({ id, label }))}
      event={{ name: event.name, slug: event.slug }}
      forms={forms}
      speakers={speakers.map((speaker) => ({
        id: speaker.id,
        name:
          (speaker.profile.preferredName ?? `${speaker.profile.givenName} ${speaker.profile.familyName}`.trim()) ||
          speaker.profile.email,
        email: speaker.profile.email,
      }))}
      tracks={tracks.map(({ id, name }) => ({ id, name }))}
    />
  );
}
