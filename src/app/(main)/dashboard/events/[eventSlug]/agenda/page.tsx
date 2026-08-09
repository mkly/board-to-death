import { notFound } from "next/navigation";

import { Temporal } from "temporal-polyfill";

import { Separator } from "@/components/ui/separator";
import { type AgendaConflict, AgendaPlacementRepository, validateAgendaConflicts } from "@/server/agenda";
import { getDatabaseClient } from "@/server/database/client";
import { ProgramSessionRepository } from "@/server/sessions/repositories";
import { SpeakerRepository } from "@/server/speakers/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { AgendaConflictWorkspace } from "./_components/agenda-conflict-workspace";
import { AgendaWorkspace, type AgendaWorkspaceSession } from "./_components/agenda-workspace";

interface AgendaPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

function localDateTime(value: Date, timezone: string): string {
  return Temporal.Instant.from(value.toISOString())
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}

function conflictResourceName(
  conflict: AgendaConflict,
  names: {
    readonly rooms: ReadonlyMap<string, string>;
    readonly speakers: ReadonlyMap<string, string>;
    readonly tracks: ReadonlyMap<string, string>;
  },
): string | null {
  if (conflict.type === "room") return names.rooms.get(conflict.resourceId ?? "") ?? "Unknown room";
  if (conflict.type === "track") return names.tracks.get(conflict.resourceId ?? "") ?? "Unknown track";
  if (conflict.type === "speaker") return names.speakers.get(conflict.resourceId ?? "") ?? "Unknown speaker";
  return null;
}

function conflictSummary(
  conflict: AgendaConflict,
  placementTitles: ReadonlyMap<string, string>,
  resourceName: string | null,
): string {
  const titles = conflict.placementIds.map((placementId) => placementTitles.get(placementId) ?? "Unknown session");
  if (conflict.type === "event-boundary") return `${titles[0]} falls outside the event schedule.`;
  let resourcePhrase = `for speaker ${resourceName ?? "Unknown speaker"}`;
  if (conflict.type === "room") resourcePhrase = `in room ${resourceName ?? "Unknown room"}`;
  if (conflict.type === "track") resourcePhrase = `on track ${resourceName ?? "Unknown track"}`;
  return `${titles[0]} and ${titles[1]} overlap ${resourcePhrase}.`;
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
  const agendaSessions: readonly AgendaWorkspaceSession[] = sessions.map((session) => {
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
  });
  const sessionById = new Map(agendaSessions.map((session) => [session.id, session]));
  const placementTitles = new Map(
    placements.map((placement) => [placement.id, sessionById.get(placement.sessionId)?.title ?? "Unknown session"]),
  );
  const conflicts = validateAgendaConflicts(
    { startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone },
    placements,
  );
  const timeFormatter = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: event.timezone,
  });

  return (
    <div className="flex flex-col gap-8">
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
        sessions={agendaSessions}
      />
      <Separator />
      <AgendaConflictWorkspace
        event={{ slug: event.slug, timezone: event.timezone }}
        rooms={rooms.map((room) => ({ id: room.id, name: room.name }))}
        tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
        placements={placements.map((placement) => {
          const session = sessionById.get(placement.sessionId);
          return {
            id: placement.id,
            sessionId: placement.sessionId,
            title: session?.title ?? "Unknown session",
            roomId: placement.roomId,
            roomName: roomNames.get(placement.roomId) ?? "Unknown room",
            startsAtLocal: localDateTime(placement.startsAt, event.timezone),
            timeLabel: `${timeFormatter.format(placement.startsAt)} – ${timeFormatter.format(placement.endsAt)}`,
            durationMinutes: placement.durationMinutes,
            trackId: placement.trackIds[0] ?? null,
            trackNames: placement.trackIds.map((trackId) => trackNames.get(trackId) ?? "Unknown track"),
            speakerIds: placement.speakerIds,
            speakerNames: placement.speakerIds.map((speakerId) => speakerNames.get(speakerId) ?? "Unknown speaker"),
            version: placement.version,
          };
        })}
        conflicts={conflicts.map((conflict, index) => {
          const resourceName = conflictResourceName(conflict, {
            rooms: roomNames,
            speakers: speakerNames,
            tracks: trackNames,
          });
          return {
            id: `${conflict.type}-${conflict.placementIds.join("-")}-${index}`,
            type: conflict.type,
            placementIds: conflict.placementIds,
            summary: conflictSummary(conflict, placementTitles, resourceName),
            overlapLabel: `${timeFormatter.format(conflict.overlap.startsAt)} – ${timeFormatter.format(conflict.overlap.endsAt)}`,
            resourceName,
          };
        })}
      />
    </div>
  );
}
