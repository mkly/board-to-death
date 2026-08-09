import { CalendarCog } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getDatabaseClient } from "@/server/database";
import { EventRepository, RoomRepository, TrackRepository } from "@/server/events";

import { EventSettingsWorkspace } from "./_components/event-settings-workspace";
import type { EventSettingsSnapshot } from "./types";

interface PageProps {
  readonly searchParams: Promise<{ event?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const database = getDatabaseClient();
  const events = new EventRepository(database);
  const eventOptions = (
    await database.event.findMany({
      orderBy: [{ archivedAt: "asc" }, { startsAt: "asc" }],
      select: { id: true, name: true, archivedAt: true },
    })
  ).map(({ id, name, archivedAt }) => ({ id, name, archived: archivedAt !== null }));
  const requestedEventId = (await searchParams).event;
  const eventId = eventOptions.some(({ id }) => id === requestedEventId) ? requestedEventId : eventOptions[0]?.id;

  let initialSnapshot: EventSettingsSnapshot | null = null;
  if (eventId) {
    const [event, rooms, tracks] = await Promise.all([
      events.get(eventId),
      new RoomRepository(database).list(eventId),
      new TrackRepository(database).list(eventId),
    ]);
    if (event) {
      initialSnapshot = {
        event: {
          ...event,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
          archivedAt: event.archivedAt?.toISOString() ?? null,
        },
        rooms: rooms.map(({ id, name, sortOrder }) => ({ id, name, sortOrder })),
        tracks: tracks.map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder })),
      };
    }
  }

  if (eventOptions.length === 0) {
    return (
      <Empty className="min-h-96 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarCog />
          </EmptyMedia>
          <EmptyTitle>No events yet</EmptyTitle>
          <EmptyDescription>Create an event to configure its identity, schedule, rooms, and tracks.</EmptyDescription>
        </EmptyHeader>
        <EventSettingsWorkspace eventOptions={[]} initialSnapshot={null} />
      </Empty>
    );
  }

  return (
    <EventSettingsWorkspace
      key={initialSnapshot?.event.id}
      eventOptions={eventOptions}
      initialSnapshot={initialSnapshot}
    />
  );
}
