import ical, { ICalEventStatus } from "ical-generator";

import type { PublicPublishedProgramLookup, PublishedProgramSnapshot } from "./repositories.ts";

const MAX_SELECTED_PLACEMENTS = 500;
const calendarProductId = {
  company: "GatherPulse",
  product: "Personal Itinerary",
  language: "EN",
} as const;

export interface PublishedProgramReader {
  findPublic(identifier: string): Promise<PublicPublishedProgramLookup>;
}

function selectedPlacementIds(value: unknown): readonly string[] | null {
  if (!value || typeof value !== "object" || !("placementIds" in value)) return null;
  const placementIds = value.placementIds;
  if (!Array.isArray(placementIds) || placementIds.length === 0 || placementIds.length > MAX_SELECTED_PLACEMENTS) {
    return null;
  }
  if (placementIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 100)) return null;
  return [...new Set(placementIds)];
}

export function createPublishedItineraryCalendar(
  snapshot: PublishedProgramSnapshot,
  placementIds: readonly string[],
  stamp = new Date(),
): { readonly content: string; readonly eventCount: number } {
  const selectedIds = new Set(placementIds);
  const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const rooms = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const calendar = ical({
    name: `${snapshot.event.name} personal itinerary`,
    prodId: calendarProductId,
  });

  let eventCount = 0;
  for (const placement of snapshot.placements) {
    if (!selectedIds.has(placement.id)) continue;
    const session = sessions.get(placement.sessionId);
    if (!session) continue;

    calendar.createEvent({
      id: `${placement.id}.${snapshot.event.id}@gatherpulse`,
      start: new Date(placement.startsAt),
      end: new Date(placement.endsAt),
      stamp,
      summary: session.title,
      description: session.description,
      location: rooms.get(placement.roomId)?.name ?? snapshot.event.location,
      status: ICalEventStatus.CONFIRMED,
    });
    eventCount += 1;
  }

  return { content: calendar.toString(), eventCount };
}

function unavailable(status: PublicPublishedProgramLookup["status"]): Response {
  return new Response(status === "unpublished" ? "Program unpublished" : "Program not found", {
    status: status === "unpublished" ? 410 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handlePublishedItineraryCalendarRequest(
  request: Request,
  eventSlug: string,
  reader: PublishedProgramReader,
): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const placementIds = selectedPlacementIds(body);
  if (!placementIds) {
    return new Response("placementIds must contain between 1 and 500 placement identifiers", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const publication = await reader.findPublic(eventSlug);
  if (publication.status !== "published") return unavailable(publication.status);

  const calendar = createPublishedItineraryCalendar(publication.version.snapshot, placementIds);
  if (calendar.eventCount === 0) {
    return new Response("No selected sessions are in the published program", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(calendar.content, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${publication.version.snapshot.event.slug}-itinerary.ics"`,
      "Content-Type": "text/calendar; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
