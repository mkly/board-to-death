import { notFound, redirect } from "next/navigation";

import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { getDatabaseClient } from "@/server/database/client";
import { listParticipantPortals, resolveParticipantPortal } from "@/server/participant-portals";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { ParticipantPortalWorkspace } from "./_components/participant-portal-workspace";

interface ParticipantPortalsPageProps {
  readonly params: Promise<{ readonly eventSlug: string }>;
}

export default async function ParticipantPortalsPage({ params }: ParticipantPortalsPageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id)
    redirect(shell.activeEvent ? dashboardEventHref(shell.activeEvent.slug, "portals") : "/dashboard");

  const database = getDatabaseClient();
  const [portals, speakers] = await Promise.all([
    listParticipantPortals(database, event.id),
    database.speaker.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        profileVersions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { givenName: true, familyName: true, email: true },
        },
      },
    }),
  ]);
  const previewParticipants = await Promise.all(
    speakers.flatMap((speaker) => {
      const profile = speaker.profileVersions[0];
      return profile
        ? [
            resolveParticipantPortal(database, { eventId: event.id, speakerId: speaker.id }).then((portal) => ({
              id: speaker.id,
              name: `${profile.givenName} ${profile.familyName}`,
              email: profile.email,
              portalName: portal.name,
              portalWelcomeMessage: portal.welcomeMessage,
            })),
          ]
        : [];
    }),
  );

  return (
    <ParticipantPortalWorkspace
      event={{ name: event.name, slug: event.slug }}
      portals={portals}
      previewParticipants={previewParticipants}
    />
  );
}
