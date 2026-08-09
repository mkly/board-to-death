import { describe, test } from "vitest";

import { PublishedProgramState } from "../../generated/prisma/client.ts";
import { handlePublicProgramOptions, handlePublicProgramRequest, type PublicProgramReader } from "./public-api.ts";
import type { PersistedPublishedProgramVersion, PublishedProgramSnapshot } from "./repositories.ts";
import assert from "node:assert/strict";

const snapshot: PublishedProgramSnapshot = {
  schemaVersion: 1,
  event: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Board Summit",
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
      biography: "Public biography",
      websiteUrl: null,
      photoObjectKey: "events/private-storage-object.jpg",
    },
    {
      id: "speaker-2",
      givenName: "Second",
      familyName: "Speaker",
      preferredName: null,
      pronouns: null,
      organization: null,
      jobTitle: null,
      biography: null,
      websiteUrl: null,
      photoObjectKey: null,
    },
  ],
  sessions: [
    {
      id: "session-1",
      title: "Opening",
      description: null,
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

function published(versionNumber = 3): PersistedPublishedProgramVersion & { snapshot: PublishedProgramSnapshot } {
  return {
    id: `version-${versionNumber}`,
    eventId: snapshot.event.id,
    versionNumber,
    state: PublishedProgramState.PUBLISHED,
    actorPrincipalId: "private-admin-id",
    snapshot,
    createdAt: new Date("2027-02-01T12:00:00.000Z"),
  };
}

function reader(result: Awaited<ReturnType<PublicProgramReader["findPublic"]>>): PublicProgramReader {
  return { findPublic: () => Promise.resolve(result) };
}

describe("published-program public API", () => {
  test("returns a paginated speaker allowlist with public caching and credential-free CORS", async () => {
    const response = await handlePublicProgramRequest(
      new Request("https://api.example.test/api/v1/events/board-summit/speakers?page=1&pageSize=1", {
        headers: { "x-api-key": "optional-gateway-key" },
      }),
      "board-summit",
      "speakers",
      reader({ status: "published", version: published() }),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(response.headers.get("cache-control") ?? "", /public/);
    assert.equal(body.data.length, 1);
    assert.deepEqual(body.meta.pagination, { page: 1, pageSize: 1, total: 2, totalPages: 2 });
    assert.match(body.links.next, /page=2&pageSize=1/);
    assert.doesNotMatch(JSON.stringify(body), /private-storage-object|private-admin-id|optional-gateway-key/);
  });

  test("returns stable validators and a bodyless 304 until the publication version changes", async () => {
    const request = new Request("https://api.example.test/api/v1/events/board-summit/sessions");
    const first = await handlePublicProgramRequest(
      request,
      snapshot.event.id,
      "sessions",
      reader({ status: "published", version: published(3) }),
    );
    const etag = first.headers.get("etag");
    assert.ok(etag);

    const cached = await handlePublicProgramRequest(
      new Request(request, { headers: { "if-none-match": etag } }),
      snapshot.event.id,
      "sessions",
      reader({ status: "published", version: published(3) }),
    );
    const republished = await handlePublicProgramRequest(
      new Request(request, { headers: { "if-none-match": etag } }),
      snapshot.event.id,
      "sessions",
      reader({ status: "published", version: published(4) }),
    );

    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), "");
    assert.equal(republished.status, 200);
    assert.notEqual(republished.headers.get("etag"), etag);
  });

  test("distinguishes unknown, never-published, and explicitly unpublished events", async () => {
    const request = new Request("https://api.example.test/api/v1/events/missing/agenda");
    const cases = [
      [{ status: "event-not-found" } as const, 404, "EVENT_NOT_FOUND"],
      [{ status: "not-published", eventId: "event-1" } as const, 404, "PROGRAM_NOT_PUBLISHED"],
      [{ status: "unpublished", eventId: "event-1", versionNumber: 4 } as const, 410, "PROGRAM_UNPUBLISHED"],
    ] as const;

    for (const [result, status, code] of cases) {
      const response = await handlePublicProgramRequest(request, "missing", "agenda", reader(result));
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    }
  });

  test("rejects malformed or excessive pagination and answers preflight without credentials", async () => {
    for (const query of ["?page=0", "?page=abc", "?pageSize=101", "?page=1&page=2"]) {
      const response = await handlePublicProgramRequest(
        new Request(`https://api.example.test/api/v1/events/event/sessions${query}`),
        "event",
        "sessions",
        reader({ status: "published", version: published() }),
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_PAGINATION");
    }

    const options = handlePublicProgramOptions();
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("access-control-allow-origin"), "*");
    assert.equal(options.headers.get("access-control-allow-credentials"), null);
    assert.match(options.headers.get("access-control-allow-headers") ?? "", /X-API-Key/);
  });
});
