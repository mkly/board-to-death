import { notFound, redirect } from "next/navigation";

import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerRepository } from "@/server/speakers";

import { getDashboardShellData } from "../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../_lib/dashboard-shell";
import { SpeakerDetail } from "../_components/speaker-detail";

export default async function SpeakerDetailPage({
  params,
}: {
  readonly params: Promise<{ eventSlug: string; speakerId: string }>;
}) {
  const [{ eventSlug, speakerId }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(shell.activeEvent ? dashboardEventHref(shell.activeEvent.slug, "speakers") : "/dashboard");
  }
  const client = getDatabaseClient();
  const [speaker, assignments] = await Promise.all([
    new SpeakerRepository(client).get(event.id, speakerId),
    client.speakerTaskAssignment.findMany({
      where: { eventId: event.id, speakerId },
      include: { definitionVersion: { select: { title: true } } },
      orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    }),
  ]);
  if (!speaker) notFound();
  return <SpeakerDetail event={event} speaker={speaker} assignments={assignments} />;
}
