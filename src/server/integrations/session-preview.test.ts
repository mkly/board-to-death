import { describe, expect, it } from "vitest";

import { IntegrationRemoteRecordStatus } from "../../generated/prisma/client.ts";
import type { PublishedProgramSnapshot } from "../published-program/repositories.ts";
import { DeterministicAcceleventsAdapter } from "./accelevents.ts";
import {
  buildSessionOutboundRecords,
  DEFAULT_SESSION_MAPPING,
  previewAcceleventsSessions,
  type SessionRemoteRecord,
} from "./session-preview.ts";
import { sessionPreviewCsv } from "./session-preview-csv.ts";

const eventId = "00000000-0000-4000-8000-000000000001";
const sessionIds = ["create", "update", "unchanged", "skipped", "invalid"] as const;

function sessionSpeakerIds(id: (typeof sessionIds)[number]): readonly string[] {
  if (id === "invalid") return ["missing-speaker"];
  return id === "create" ? [] : ["speaker-1"];
}

function snapshot(): PublishedProgramSnapshot {
  return {
    schemaVersion: 1,
    event: {
      id: eventId,
      name: "Mapping Summit",
      slug: "mapping-summit",
      websiteUrl: null,
      location: null,
      timezone: "UTC",
      startsAt: "2027-03-13T09:00:00.000Z",
      endsAt: "2027-03-13T18:00:00.000Z",
      theme: "Practical integrations",
    },
    rooms: [{ id: "room-1", name: "Main Hall", sortOrder: 0 }],
    tracks: [{ id: "track-1", name: "Operations", color: "blue", sortOrder: 0 }],
    speakers: [
      {
        id: "speaker-1",
        givenName: "Ada",
        familyName: "Lovelace",
        preferredName: "Ada",
        pronouns: null,
        organization: null,
        jobTitle: null,
        biography: null,
        websiteUrl: null,
        photoObjectKey: null,
      },
    ],
    sessions: sessionIds.map((id) => ({
      id,
      title: id === "create" ? "=FORMULA" : `${id} session`,
      description: `${id} description`,
      durationMinutes: 45,
      trackId: "track-1",
      speakerIds: sessionSpeakerIds(id),
    })),
    placements: sessionIds.map((sessionId, index) => ({
      id: `placement-${sessionId}`,
      sessionId,
      roomId: "room-1",
      startsAt: `2027-03-13T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
      endsAt: `2027-03-13T${String(9 + index).padStart(2, "0")}:45:00.000Z`,
      trackIds: ["track-1"],
      speakerIds: sessionId === "create" ? [] : ["speaker-1"],
    })),
  };
}

function remoteRecords(): SessionRemoteRecord[] {
  return [
    {
      localId: "speaker-1",
      remoteId: "remote-speaker-1",
      resourceType: "speaker",
      status: IntegrationRemoteRecordStatus.ACTIVE,
    },
    ...(["update", "unchanged"] as const).map((localId) => ({
      localId,
      remoteId: `remote-${localId}`,
      resourceType: "session",
      status: IntegrationRemoteRecordStatus.ACTIVE,
    })),
    {
      localId: "skipped",
      remoteId: "remote-skipped",
      resourceType: "session",
      status: IntegrationRemoteRecordStatus.STALE,
    },
  ];
}

function adapter() {
  return new DeterministicAcceleventsAdapter({
    remoteEventId: "remote-event",
    apiKey: "runtime-key",
    pageSize: 1,
    speakers: [
      {
        remoteId: "remote-speaker-1",
        email: "ada@example.test",
        firstName: "Ada",
        lastName: "Lovelace",
      },
    ],
    sessions: [
      {
        remoteId: "remote-update",
        title: "Old title",
        description: "update description",
        speakerRemoteIds: ["remote-speaker-1"],
      },
      {
        remoteId: "remote-unchanged",
        title: "unchanged session",
        description: "unchanged description",
        speakerRemoteIds: ["remote-speaker-1"],
      },
    ],
  });
}

describe("Accelevents session mapping preview", () => {
  it("classifies paginated mixed actions with per-record validation explanations", async () => {
    const fake = adapter();
    const result = await previewAcceleventsSessions({
      eventId,
      remoteEventId: "remote-event",
      snapshot: snapshot(),
      mapping: DEFAULT_SESSION_MAPPING,
      remoteRecords: remoteRecords(),
      connection: { remoteEventId: "remote-event", apiKey: "runtime-key" },
      adapter: fake,
    });

    expect(result.status).toBe("ready");
    expect(result.records.map(({ action }) => action)).toEqual(["create", "update", "unchanged", "skipped", "invalid"]);
    expect(result.records.at(-1)?.explanations).toContain(
      "Speaker missing-speaker is not linked to an active Accelevents speaker.",
    );
    expect(fake.requests.filter(({ operation }) => operation === "list-sessions")).toHaveLength(2);
  });

  it("recomputes outbound fields when a mapping changes", async () => {
    const result = await previewAcceleventsSessions({
      eventId,
      remoteEventId: "remote-event",
      snapshot: snapshot(),
      mapping: { title: "event.name", description: "event.theme", speakers: "omit" },
      remoteRecords: remoteRecords(),
      connection: { remoteEventId: "remote-event", apiKey: "runtime-key" },
      adapter: adapter(),
    });

    expect(result.records[0]).toMatchObject({
      title: "Mapping Summit",
      description: "Practical integrations",
      speakerRemoteIds: [],
    });
    expect(result.records.find(({ localId }) => localId === "unchanged")?.action).toBe("update");
  });

  it("keeps local records and exposes the CSV fallback when the fake disconnects", async () => {
    const fake = adapter();
    fake.failNext("check-credentials", "unavailable");
    const result = await previewAcceleventsSessions({
      eventId,
      remoteEventId: "remote-event",
      snapshot: snapshot(),
      mapping: DEFAULT_SESSION_MAPPING,
      remoteRecords: remoteRecords(),
      connection: { remoteEventId: "remote-event", apiKey: "runtime-key" },
      adapter: fake,
    });

    expect(result.status).toBe("disconnected");
    expect(result.records).toHaveLength(5);
    const csv = sessionPreviewCsv(result.records);
    expect(csv).toContain("'=FORMULA");
    expect(csv).toContain('"localSessionId","remoteSessionId","title"');
    expect(fake.requests).toHaveLength(1);
  });

  it("rejects a cross-event snapshot before any adapter call", async () => {
    const fake = adapter();
    await expect(
      previewAcceleventsSessions({
        eventId: "another-event",
        remoteEventId: "remote-event",
        snapshot: snapshot(),
        mapping: DEFAULT_SESSION_MAPPING,
        remoteRecords: remoteRecords(),
        connection: { remoteEventId: "remote-event", apiKey: "runtime-key" },
        adapter: fake,
      }),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(fake.requests).toHaveLength(0);
  });

  it("handles an empty published dataset without special cases", async () => {
    const empty = snapshot();
    const result = await previewAcceleventsSessions({
      eventId,
      remoteEventId: "remote-event",
      snapshot: { ...empty, sessions: [], placements: [] },
      mapping: DEFAULT_SESSION_MAPPING,
      remoteRecords: [],
      connection: { remoteEventId: "remote-event", apiKey: "runtime-key" },
      adapter: adapter(),
    });
    expect(result).toMatchObject({ status: "ready", records: [] });
  });

  it("validates schedule order before comparison", () => {
    const source = snapshot();
    const records = buildSessionOutboundRecords(
      eventId,
      {
        ...source,
        placements: source.placements.map((placement) =>
          placement.sessionId === "create" ? { ...placement, endsAt: placement.startsAt } : placement,
        ),
      },
      DEFAULT_SESSION_MAPPING,
      remoteRecords(),
    );
    expect(records[0]).toMatchObject({ action: "invalid" });
    expect(records[0]?.explanations).toContain("Published schedule times are invalid or out of order.");
  });

  it("invalidates records whose linked remote speaker no longer exists remotely", async () => {
    const result = await previewAcceleventsSessions({
      eventId,
      remoteEventId: "remote-event",
      snapshot: snapshot(),
      mapping: DEFAULT_SESSION_MAPPING,
      remoteRecords: remoteRecords(),
      connection: { remoteEventId: "remote-event", apiKey: "runtime-key" },
      adapter: new DeterministicAcceleventsAdapter({
        remoteEventId: "remote-event",
        apiKey: "runtime-key",
        speakers: [],
        sessions: [
          { remoteId: "remote-update", title: "Old title", description: "update description", speakerRemoteIds: [] },
        ],
      }),
    });

    const record = result.records.find(({ localId }) => localId === "update");
    expect(record?.action).toBe("invalid");
    expect(record?.explanations).toContain("Linked Accelevents speaker remote-speaker-1 is unavailable.");
  });

  it("invalidates records whose linked remote session no longer exists remotely", async () => {
    const result = await previewAcceleventsSessions({
      eventId,
      remoteEventId: "remote-event",
      snapshot: snapshot(),
      mapping: DEFAULT_SESSION_MAPPING,
      remoteRecords: remoteRecords(),
      connection: { remoteEventId: "remote-event", apiKey: "runtime-key" },
      adapter: new DeterministicAcceleventsAdapter({
        remoteEventId: "remote-event",
        apiKey: "runtime-key",
        speakers: [
          { remoteId: "remote-speaker-1", email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" },
        ],
        sessions: [],
      }),
    });

    const record = result.records.find(({ localId }) => localId === "update");
    expect(record?.action).toBe("invalid");
    expect(record?.explanations).toContain("Linked Accelevents session remote-update is unavailable.");
  });

  it("emits one outbound record per local session when a session is placed more than once", () => {
    const source = snapshot();
    const doubled: PublishedProgramSnapshot = {
      ...source,
      // A published snapshot repeats the session entry for every placement.
      sessions: [...source.sessions, ...source.sessions.filter(({ id }) => id === "unchanged")],
      placements: [
        ...source.placements,
        {
          id: "placement-unchanged-second",
          sessionId: "unchanged",
          roomId: "room-1",
          startsAt: "2027-03-13T15:00:00.000Z",
          endsAt: "2027-03-13T15:45:00.000Z",
          trackIds: ["track-1"],
          speakerIds: ["speaker-1"],
        },
      ],
    };
    const records = buildSessionOutboundRecords(eventId, doubled, DEFAULT_SESSION_MAPPING, remoteRecords());

    expect(records.map(({ localId }) => localId)).toEqual([...sessionIds]);
    const record = records.find(({ localId }) => localId === "unchanged");
    expect(record?.action).toBe("invalid");
    expect(record?.explanations).toContain("Session must have exactly one published placement.");
  });
});
