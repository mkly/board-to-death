import { headers } from "next/headers";

import { AgendaPlacementRepository } from "@/server/agenda";
import { createAgendaCsv } from "@/server/agenda/export";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { ProgramSessionRepository } from "@/server/sessions/repositories";
import { SpeakerRepository } from "@/server/speakers/repositories";

interface AgendaExportRouteContext {
  readonly params: Promise<{ eventSlug: string }>;
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function GET(request: Request, { params }: AgendaExportRouteContext): Promise<Response> {
  const [{ eventSlug }, session] = await Promise.all([params, auth.api.getSession({ headers: await headers() })]);
  if (!(await isAuthorizedAdminSession(session, { slug: eventSlug }))) {
    return new Response("Not found", { status: 404 });
  }

  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true, timezone: true },
  });
  if (!event) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  if (status && !["all", "scheduled", "unscheduled"].includes(status)) {
    return new Response("Invalid agenda status filter", { status: 400 });
  }
  const roomId = url.searchParams.get("room") || undefined;
  const trackId = url.searchParams.get("track") || undefined;
  const [placements, sessions, rooms, tracks, speakers] = await Promise.all([
    new AgendaPlacementRepository(client).list(event.id),
    new ProgramSessionRepository(client).list(event.id),
    client.room.findMany({ where: { eventId: event.id }, select: { id: true, name: true } }),
    client.track.findMany({ where: { eventId: event.id }, select: { id: true, name: true } }),
    new SpeakerRepository(client).list(event.id),
  ]);
  const sessionTitles = new Map(sessions.map((item) => [item.id, item.version.title]));
  const sessionTrackIds = new Map(sessions.map((item) => [item.id, item.version.trackId]));
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  const trackNames = new Map(tracks.map((track) => [track.id, track.name]));
  const speakerNames = new Map(
    speakers.map((speaker) => [
      speaker.id,
      speaker.profile.preferredName ?? `${speaker.profile.givenName} ${speaker.profile.familyName}`,
    ]),
  );
  const filtered =
    status === "unscheduled"
      ? []
      : placements.filter(
          (placement) =>
            (!roomId || placement.roomId === roomId) &&
            (!trackId ||
              (placement.trackIds.length > 0
                ? placement.trackIds.includes(trackId)
                : sessionTrackIds.get(placement.sessionId) === trackId)),
        );
  const bytes = createAgendaCsv(
    filtered.map((placement) => ({
      id: placement.id,
      sessionId: placement.sessionId,
      sessionTitle: sessionTitles.get(placement.sessionId) ?? "Unknown session",
      startsAt: placement.startsAt,
      endsAt: placement.endsAt,
      roomId: placement.roomId,
      roomName: roomNames.get(placement.roomId) ?? "Unknown room",
      trackIds: placement.trackIds,
      trackNames: placement.trackIds.map((id) => trackNames.get(id) ?? "Unknown track"),
      speakerIds: placement.speakerIds,
      speakerNames: placement.speakerIds.map((id) => speakerNames.get(id) ?? "Unknown speaker"),
    })),
    event.timezone,
  );

  return new Response(responseBody(bytes), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}-agenda.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
