import { describe, test } from "vitest";

import { PublishedProgramState } from "../../generated/prisma/client.ts";
import type { PublicProgramReader } from "./public-api.ts";
import { handlePublishedScheduleFeedRequest } from "./public-feed.ts";
import type { PersistedPublishedProgramVersion, PublishedProgramSnapshot } from "./repositories.ts";
import assert from "node:assert/strict";

const snapshot: PublishedProgramSnapshot = {
  schemaVersion: 1,
  event: {
    id: "event-1",
    name: "Board & Card Summit",
    slug: "board-summit",
    websiteUrl: "https://example.test",
    location: "Oakland",
    timezone: "America/Los_Angeles",
    startsAt: "2027-03-13T17:00:00.000Z",
    endsAt: "2027-03-15T00:00:00.000Z",
    theme: null,
  },
  rooms: [{ id: "room-1", name: "Main Hall", sortOrder: 0 }],
  tracks: [{ id: "track-1", name: "Strategy", color: "blue", sortOrder: 0 }],
  speakers: [
    {
      id: "speaker-1",
      givenName: "Public",
      familyName: "Speaker",
      preferredName: null,
      pronouns: null,
      organization: "Tabletop Guild",
      jobTitle: null,
      biography: null,
      websiteUrl: null,
      photoObjectKey: "events/private-storage-object.jpg",
    },
  ],
  sessions: [
    {
      id: "session-1",
      title: "Opening <script>",
      description: "Welcome & introductions",
      durationMinutes: 45,
      trackId: "track-1",
      speakerIds: ["speaker-1"],
    },
  ],
  placements: [
    {
      id: "placement-1",
      sessionId: "session-1",
      roomId: "room-1",
      startsAt: "2027-03-13T18:00:00.000Z",
      endsAt: "2027-03-13T18:45:00.000Z",
      trackIds: ["track-1"],
      speakerIds: ["speaker-1"],
    },
  ],
};

function published(): PersistedPublishedProgramVersion & { snapshot: PublishedProgramSnapshot } {
  return {
    id: "version-3",
    eventId: snapshot.event.id,
    versionNumber: 3,
    state: PublishedProgramState.PUBLISHED,
    actorPrincipalId: "private-admin-id",
    snapshot,
    createdAt: new Date("2027-02-01T12:00:00.000Z"),
  };
}

function reader(result: Awaited<ReturnType<PublicProgramReader["findPublic"]>>): PublicProgramReader {
  return { findPublic: () => Promise.resolve(result) };
}

describe("published schedule feeds", () => {
  test("returns anonymous HTML, JSON, XML, and iCal from the published snapshot", async () => {
    const expected = {
      html: ["text/html", "Opening &lt;script&gt;"],
      json: ["application/json", '"title": "Opening <script>"'],
      xml: ["application/xml", "Opening &lt;script&gt;"],
      ical: ["text/calendar", "SUMMARY:Opening <script>"],
    } as const;

    for (const [format, [contentType, content]] of Object.entries(expected)) {
      const response = await handlePublishedScheduleFeedRequest(
        new Request(`https://example.test/embed/board-summit/feeds/${format}`),
        "board-summit",
        format as keyof typeof expected,
        reader({ status: "published", version: published() }),
      );
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", new RegExp(contentType));
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.match(response.headers.get("cache-control") ?? "", /public/);
      assert.match(body, new RegExp(content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(body, /private-storage-object|private-admin-id/);
      if (format === "ical") {
        // TZID may only reference a VTIMEZONE component in the same object, so
        // every timestamp has to be emitted in UTC form.
        assert.doesNotMatch(body, /TZID=/);
        assert.match(body, /DTSTAMP:\d{8}T\d{6}Z/);
        assert.match(body, /DTSTART:20270313T180000Z/);
        assert.match(body, /X-WR-TIMEZONE:America\/Los_Angeles/);
      }
    }
  });

  test("returns stable validators and distinguishes unavailable publication states", async () => {
    const request = new Request("https://example.test/embed/board-summit/feeds/json");
    const first = await handlePublishedScheduleFeedRequest(
      request,
      "board-summit",
      "json",
      reader({ status: "published", version: published() }),
    );
    const etag = first.headers.get("etag");
    assert.ok(etag);

    const cached = await handlePublishedScheduleFeedRequest(
      new Request(request, { headers: { "if-none-match": etag } }),
      "board-summit",
      "json",
      reader({ status: "published", version: published() }),
    );
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), "");

    const cases = [
      [{ status: "event-not-found" } as const, 404],
      [{ status: "not-published", eventId: "event-1" } as const, 404],
      [{ status: "unpublished", eventId: "event-1", versionNumber: 3 } as const, 410],
    ] as const;
    for (const [result, status] of cases) {
      const response = await handlePublishedScheduleFeedRequest(request, "board-summit", "json", reader(result));
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });
});
