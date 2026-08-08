import { notFound } from "next/navigation";

import { EventSettingsWorkspace } from "@/app/(main)/dashboard/event-settings/_components/event-settings-workspace";
import type { EventSettingsSnapshot } from "@/app/(main)/dashboard/event-settings/types";
import { getDatabaseClient } from "@/server/database";
import { EventRepository, RoomRepository, TrackRepository } from "@/server/events";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";

interface EventSettingsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

export default async function EventSettingsPage({ params }: EventSettingsPageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const authorizedEvent = findAuthorizedEvent(shell.events, eventSlug);
  if (!authorizedEvent || shell.activeEvent?.id !== authorizedEvent.id) notFound();

  const database = getDatabaseClient();
  const [event, rooms, tracks] = await Promise.all([
    new EventRepository(database).get(authorizedEvent.id),
    new RoomRepository(database).list(authorizedEvent.id),
    new TrackRepository(database).list(authorizedEvent.id),
  ]);
  if (!event) notFound();

  const initialSnapshot: EventSettingsSnapshot = {
    event: { ...event, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString() },
    rooms: rooms.map(({ id, name, sortOrder }) => ({ id, name, sortOrder })),
    tracks: tracks.map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder })),
  };

  return (
    <EventSettingsWorkspace
      key={initialSnapshot.event.id}
      eventOptions={[{ id: authorizedEvent.id, name: authorizedEvent.name }]}
      initialSnapshot={initialSnapshot}
    />
  );
}
