import ical from "ical-generator";

import type { PublishedScheduleFeedFormat } from "@/lib/published-embeds/feed-formats";

import type { PublicProgramReader } from "./public-api.ts";
import type { PublishedProgramSnapshot } from "./repositories.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "If-None-Match",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag, Last-Modified, Server-Timing",
  "Access-Control-Max-Age": "86400",
} as const;

interface PublishedScheduleFeed {
  readonly schemaVersion: 1;
  readonly event: PublishedProgramSnapshot["event"];
  readonly publication: {
    readonly version: number;
    readonly publishedAt: string;
  };
  readonly rooms: PublishedProgramSnapshot["rooms"];
  readonly tracks: PublishedProgramSnapshot["tracks"];
  readonly speakers: readonly Omit<PublishedProgramSnapshot["speakers"][number], "photoObjectKey">[];
  readonly sessions: PublishedProgramSnapshot["sessions"];
  readonly schedule: readonly {
    readonly id: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly session: PublishedProgramSnapshot["sessions"][number];
    readonly room: PublishedProgramSnapshot["rooms"][number];
    readonly tracks: PublishedProgramSnapshot["tracks"];
    readonly speakers: readonly Omit<PublishedProgramSnapshot["speakers"][number], "photoObjectKey">[];
  }[];
}

interface SerializedFeed {
  readonly body: string;
  readonly contentType: string;
  readonly extension: string;
}

function speakerName(speaker: PublishedScheduleFeed["speakers"][number]): string {
  return `${speaker.preferredName ?? speaker.givenName} ${speaker.familyName}`;
}

function scheduleFeed(snapshot: PublishedProgramSnapshot, version: number, publishedAt: Date): PublishedScheduleFeed {
  const rooms = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const tracks = new Map(snapshot.tracks.map((track) => [track.id, track]));
  const speakers = snapshot.speakers.map(({ photoObjectKey: _photoObjectKey, ...speaker }) => speaker);
  const speakersById = new Map(speakers.map((speaker) => [speaker.id, speaker]));
  const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]));

  return {
    schemaVersion: 1,
    event: snapshot.event,
    publication: { version, publishedAt: publishedAt.toISOString() },
    rooms: snapshot.rooms,
    tracks: snapshot.tracks,
    speakers,
    sessions: snapshot.sessions,
    schedule: snapshot.placements.flatMap((placement) => {
      const session = sessions.get(placement.sessionId);
      const room = rooms.get(placement.roomId);
      if (!session || !room) return [];
      const speakerIds = [...new Set([...session.speakerIds, ...placement.speakerIds])];
      return [
        {
          id: placement.id,
          startsAt: placement.startsAt,
          endsAt: placement.endsAt,
          session,
          room,
          tracks: placement.trackIds.flatMap((trackId) => {
            const track = tracks.get(trackId);
            return track ? [track] : [];
          }),
          speakers: speakerIds.flatMap((speakerId) => {
            const speaker = speakersById.get(speakerId);
            return speaker ? [speaker] : [];
          }),
        },
      ];
    }),
  };
}

function escapeMarkup(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function htmlFeed(feed: PublishedScheduleFeed): string {
  const items = feed.schedule
    .map((placement) => {
      const speakers = placement.speakers.map(speakerName).join(", ");
      const tracks = placement.tracks.map((track) => track.name).join(", ");
      return `<article>
  <h2>${escapeMarkup(placement.session.title)}</h2>
  <p><time datetime="${escapeMarkup(placement.startsAt)}">${escapeMarkup(placement.startsAt)}</time>–<time datetime="${escapeMarkup(placement.endsAt)}">${escapeMarkup(placement.endsAt)}</time></p>
  <p>Room: ${escapeMarkup(placement.room.name)}</p>
  ${speakers ? `<p>Speakers: ${escapeMarkup(speakers)}</p>` : ""}
  ${tracks ? `<p>Tracks: ${escapeMarkup(tracks)}</p>` : ""}
  ${placement.session.description ? `<p>${escapeMarkup(placement.session.description)}</p>` : ""}
</article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeMarkup(feed.event.name)} schedule</title>
</head>
<body>
  <header>
    <h1>${escapeMarkup(feed.event.name)}</h1>
    <p>Published schedule · ${escapeMarkup(feed.event.timezone)}</p>
  </header>
  <main>${items || "<p>No sessions are currently scheduled.</p>"}</main>
</body>
</html>`;
}

function xmlElement(name: string, value: string): string {
  return `<${name}>${escapeMarkup(value)}</${name}>`;
}

function xmlFeed(feed: PublishedScheduleFeed): string {
  const placements = feed.schedule
    .map(
      (placement) => `<placement id="${escapeMarkup(placement.id)}">
  ${xmlElement("startsAt", placement.startsAt)}
  ${xmlElement("endsAt", placement.endsAt)}
  <session id="${escapeMarkup(placement.session.id)}">
    ${xmlElement("title", placement.session.title)}
    ${placement.session.description ? xmlElement("description", placement.session.description) : ""}
  </session>
  <room id="${escapeMarkup(placement.room.id)}">${escapeMarkup(placement.room.name)}</room>
  <tracks>${placement.tracks.map((track) => `<track id="${escapeMarkup(track.id)}">${escapeMarkup(track.name)}</track>`).join("")}</tracks>
  <speakers>${placement.speakers.map((speaker) => `<speaker id="${escapeMarkup(speaker.id)}">${escapeMarkup(speakerName(speaker))}</speaker>`).join("")}</speakers>
</placement>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<publishedProgram schemaVersion="1">
  <event id="${escapeMarkup(feed.event.id)}" slug="${escapeMarkup(feed.event.slug)}">
    ${xmlElement("name", feed.event.name)}
    ${xmlElement("timezone", feed.event.timezone)}
    ${xmlElement("startsAt", feed.event.startsAt)}
    ${xmlElement("endsAt", feed.event.endsAt)}
  </event>
  <publication version="${feed.publication.version}" publishedAt="${escapeMarkup(feed.publication.publishedAt)}" />
  <schedule>${placements}</schedule>
</publishedProgram>`;
}

function icalFeed(feed: PublishedScheduleFeed): string {
  const publishedAt = new Date(feed.publication.publishedAt);
  // Times stay in UTC: a TZID parameter would have to point at a VTIMEZONE
  // component ical-generator does not emit, so the event timezone travels as
  // the display hint clients read instead.
  const calendar = ical({
    name: `${feed.event.name} schedule`,
    prodId: { company: "Board to Death", product: "Published Program", language: "EN" },
    x: [["X-WR-TIMEZONE", feed.event.timezone]],
  });

  for (const placement of feed.schedule) {
    calendar.createEvent({
      id: `${placement.id}.${feed.event.id}@board-to-death`,
      start: new Date(placement.startsAt),
      end: new Date(placement.endsAt),
      stamp: publishedAt,
      lastModified: publishedAt,
      summary: placement.session.title,
      description: placement.session.description,
      location: placement.room.name,
      categories: placement.tracks.map((track) => ({ name: track.name })),
      x:
        placement.speakers.length > 0
          ? [["X-BOARD-TO-DEATH-SPEAKERS", placement.speakers.map(speakerName).join(", ")]]
          : [],
    });
  }

  return calendar.toString();
}

function serializeFeed(feed: PublishedScheduleFeed, format: PublishedScheduleFeedFormat): SerializedFeed {
  if (format === "html") return { body: htmlFeed(feed), contentType: "text/html; charset=utf-8", extension: "html" };
  if (format === "xml") return { body: xmlFeed(feed), contentType: "application/xml; charset=utf-8", extension: "xml" };
  if (format === "ical") {
    return { body: icalFeed(feed), contentType: "text/calendar; charset=utf-8", extension: "ics" };
  }
  return {
    body: `${JSON.stringify(feed, null, 2)}\n`,
    contentType: "application/json; charset=utf-8",
    extension: "json",
  };
}

function unavailableResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handlePublishedScheduleFeedRequest(
  request: Request,
  eventIdentifier: string,
  format: PublishedScheduleFeedFormat,
  reader: PublicProgramReader,
): Promise<Response> {
  const result = await reader.findPublic(eventIdentifier);
  if (result.status === "event-not-found") return unavailableResponse(404, "Event not found.");
  if (result.status === "not-published") return unavailableResponse(404, "Program not published.");
  if (result.status === "unpublished") return unavailableResponse(410, "Program unpublished.");

  const etag = `"${result.version.snapshot.event.id}:v${result.version.versionNumber}:feed:${format}"`;
  const serialized = serializeFeed(
    scheduleFeed(result.version.snapshot, result.version.versionNumber, result.version.createdAt),
    format,
  );
  const headers = {
    ...CORS_HEADERS,
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    "Content-Disposition": `inline; filename="${result.version.snapshot.event.slug}-schedule.${serialized.extension}"`,
    ...(format === "html"
      ? { "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'" }
      : {}),
    "Content-Type": serialized.contentType,
    ETag: etag,
    "Last-Modified": result.version.createdAt.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(serialized.body, { headers });
}

export function handlePublishedScheduleFeedOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
