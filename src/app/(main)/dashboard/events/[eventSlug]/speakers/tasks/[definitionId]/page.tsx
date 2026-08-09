import { notFound, redirect } from "next/navigation";

import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerOnboardingRepository } from "@/server/speakers";

import { getDashboardShellData } from "../../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../../_lib/dashboard-shell";
import { TaskDetail } from "../../_components/task-detail";

export default async function TaskDetailPage({
  params,
}: {
  readonly params: Promise<{ eventSlug: string; definitionId: string }>;
}) {
  const [{ eventSlug, definitionId }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(shell.activeEvent ? dashboardEventHref(shell.activeEvent.slug, "speakers") : "/dashboard");
  }
  const client = getDatabaseClient();
  const [definition, assignments] = await Promise.all([
    new SpeakerOnboardingRepository(client).getDefinition(event.id, definitionId),
    client.speakerTaskAssignment.findMany({
      where: { eventId: event.id, definitionId },
      include: {
        speaker: {
          select: {
            id: true,
            profileVersions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { givenName: true, familyName: true, preferredName: true },
            },
          },
        },
      },
      orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    }),
  ]);
  if (!definition) notFound();
  return <TaskDetail event={event} definition={definition} assignments={assignments} />;
}
