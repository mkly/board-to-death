import { notFound } from "next/navigation";

import { getDashboardShellData } from "@/app/(main)/dashboard/_lib/dashboard-data";
import { findAuthorizedEvent } from "@/app/(main)/dashboard/_lib/dashboard-shell";
import { getDatabaseClient } from "@/server/database/client";
import { EventInvitationService } from "@/server/event-memberships";

import { EventTeamWorkspace } from "./_components/event-team-workspace";

interface EventTeamPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ notice?: string; error?: string }>;
}

export default async function EventTeamPage({ params, searchParams }: EventTeamPageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  const snapshot = await new EventInvitationService(getDatabaseClient()).list(event.id);
  return <EventTeamWorkspace event={event} snapshot={snapshot} notice={query.notice} error={query.error} />;
}
