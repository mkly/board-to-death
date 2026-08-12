import { notFound } from "next/navigation";

import { getDashboardShellData } from "@/app/(main)/dashboard/_lib/dashboard-data";
import { findAuthorizedEvent } from "@/app/(main)/dashboard/_lib/dashboard-shell";
import { getDatabaseClient } from "@/server/database/client";
import { EventInvitationService } from "@/server/event-memberships";

import { EventTeamWorkspace } from "./_components/event-team-workspace";

interface EventTeamPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

export default async function EventTeamPage({ params }: EventTeamPageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  const snapshot = await new EventInvitationService(getDatabaseClient()).list(event.id);
  return <EventTeamWorkspace event={event} snapshot={snapshot} />;
}
