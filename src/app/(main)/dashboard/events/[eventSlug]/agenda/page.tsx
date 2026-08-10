import { notFound } from "next/navigation";

import { Temporal } from "temporal-polyfill";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { type AgendaConflict, AgendaPlacementRepository, validateAgendaConflicts } from "@/server/agenda";
import { getDatabaseClient } from "@/server/database/client";
import { PublishedProgramRepository } from "@/server/published-program";
import { ProgramSessionRepository } from "@/server/sessions/repositories";
import { SpeakerRepository } from "@/server/speakers/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { AgendaConflictWorkspace } from "./_components/agenda-conflict-workspace";
import { AgendaWorkspace, type AgendaWorkspaceSession } from "./_components/agenda-workspace";
import { ProgramPublicationCard } from "./_components/program-publication-card";

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
  // Each read takes one bounded page rather than the whole table, so this screen
  // costs the same at ten sessions and at ten thousand. The caps sit above the
  // benchmarked profile in performance/budgets.json; past them the page says so
  // instead of silently dropping rows.
  const [sessionPage, placementPage, rooms, tracks, speakerPage, latestPublication] = await Promise.all([
    new ProgramSessionRepository(client).listPage(event.id),
    new AgendaPlacementRepository(client).listPage(event.id),
    client.room.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    client.track.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    new SpeakerRepository(client).listPage(event.id),
    new PublishedProgramRepository(client).latest(event.id),
  ]);
  const sessions = sessionPage.items;
  const placements = placementPage.items;
  const speakers = speakerPage.items;
  const truncated = sessionPage.hasMore || placementPage.hasMore || speakerPage.hasMore;
  const placementBySession = new Map(placements.map((placement) => [placement.sessionId, placement]));
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  const trackNames = new Map(tracks.map((track) => [track.id, track.name]));
  const speakerNames = new Map(
    speakers.map((speaker) => [
      speaker.id,
      speaker.profile.preferredName ?? `${speaker.profile.givenName} ${speaker.profile.familyName}`,
    ]),
  );
  const sessionTitles = new Map(sessions.map((session) => [session.id, session.version.title]));
  const agendaSessions: readonly AgendaWorkspaceSession[] = sessions.map((session) => {
    const placement = placementBySession.get(session.id);
    return {
      id: session.id,
      title: session.version.title,
      parentSessionId: session.parentSessionId,
      parentSessionTitle: session.parentSessionId
        ? (sessionTitles.get(session.parentSessionId) ?? "Unknown parent")
        : null,
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
  ).filter(({ placementIds }) => {
    if (placementIds.length !== 2) return true;
    const [leftPlacementId, rightPlacementId] = placementIds;
    const leftSessionId = placements.find(({ id }) => id === leftPlacementId)?.sessionId;
    const rightSessionId = placements.find(({ id }) => id === rightPlacementId)?.sessionId;
    if (!leftSessionId || !rightSessionId) return true;
    const left = sessions.find(({ id }) => id === leftSessionId);
    const right = sessions.find(({ id }) => id === rightSessionId);
    return left?.parentSessionId !== rightSessionId && right?.parentSessionId !== leftSessionId;
  });
  const timeFormatter = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: event.timezone,
  });

  return (
    <div className="flex flex-col gap-8">
      {truncated ? (
        <Alert>
          <AlertTitle>Showing part of this event</AlertTitle>
          <AlertDescription>
            This event has more sessions, placements, or speakers than the agenda screen loads at once. Conflicts are
            checked against the {placements.length} placements shown here; use the schedule export for the full program.
          </AlertDescription>
        </Alert>
      ) : null}
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
      <ProgramPublicationCard
        eventSlug={event.slug}
        publication={
          latestPublication
            ? {
                versionNumber: latestPublication.versionNumber,
                state: latestPublication.state,
                createdAtLabel: timeFormatter.format(latestPublication.createdAt),
              }
            : null
        }
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
