import { notFound } from "next/navigation";

import { Temporal } from "temporal-polyfill";

import { AgendaPlacementRepository } from "@/server/agenda";
import { getDatabaseClient } from "@/server/database/client";
import { ProgramSessionRepository } from "@/server/sessions/repositories";
import { SpeakerRepository } from "@/server/speakers/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { AgendaWorkspace } from "./_components/agenda-workspace";

interface AgendaPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

function localDateTime(value: Date, timezone: string): string {
  return Temporal.Instant.from(value.toISOString())
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}

export default async function AgendaPage({ params }: AgendaPageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const [sessions, placements, rooms, tracks, speakers] = await Promise.all([
    new ProgramSessionRepository(client).list(event.id),
    new AgendaPlacementRepository(client).list(event.id),
    client.room.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    client.track.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    new SpeakerRepository(client).list(event.id),
  ]);
  const placementBySession = new Map(placements.map((placement) => [placement.sessionId, placement]));
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  const trackNames = new Map(tracks.map((track) => [track.id, track.name]));
  const speakerNames = new Map(
    speakers.map((speaker) => [
      speaker.id,
      speaker.profile.preferredName ?? `${speaker.profile.givenName} ${speaker.profile.familyName}`,
    ]),
  );

  return (
    <AgendaWorkspace
      event={{
        name: event.name,
        slug: event.slug,
        timezone: event.timezone,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        defaultStartsAtLocal: localDateTime(event.startsAt, event.timezone),
      }}
      rooms={rooms.map((room) => ({ id: room.id, name: room.name }))}
      tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
      sessions={sessions.map((session) => {
        const placement = placementBySession.get(session.id);
        return {
          id: session.id,
          title: session.version.title,
          durationMinutes: session.version.durationMinutes,
          trackId: session.version.trackId,
          trackName: session.version.trackId ? (trackNames.get(session.version.trackId) ?? "Unknown track") : null,
          speakerIds: session.version.speakerIds,
          speakerNames: session.version.speakerIds.map((speakerId) => speakerNames.get(speakerId) ?? "Unknown speaker"),
          placement: placement
            ? {
                id: placement.id,
                startsAt: placement.startsAt.toISOString(),
                startsAtLocal: localDateTime(placement.startsAt, event.timezone),
                endsAt: placement.endsAt.toISOString(),
                durationMinutes: placement.durationMinutes,
                roomId: placement.roomId,
                roomName: roomNames.get(placement.roomId) ?? "Unknown room",
                trackId: placement.trackIds[0] ?? null,
                version: placement.version,
              }
            : null,
        };
      })}
    />
  );
}
