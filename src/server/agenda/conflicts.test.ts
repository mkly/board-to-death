import { type AgendaBounds, type AgendaPlacement, validateAgendaConflicts } from "./conflicts.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const bounds: AgendaBounds = {
  startsAt: new Date("2027-03-14T16:00:00.000Z"),
  endsAt: new Date("2027-03-15T00:00:00.000Z"),
  timezone: "America/Los_Angeles",
};

function placement(
  id: string,
  startsAt: string,
  endsAt: string,
  details: Partial<AgendaPlacement> = {},
): AgendaPlacement {
  return { id, startsAt: new Date(startsAt), endsAt: new Date(endsAt), ...details };
}

function compact(conflicts: ReturnType<typeof validateAgendaConflicts>) {
  return conflicts.map(({ type, placementIds, resourceId, overlap }) => ({
    type,
    placementIds,
    resourceId,
    overlap: [overlap.startsAt.toISOString(), overlap.endsAt.toISOString()],
  }));
}

describe("agenda conflict validation", () => {
  test("uses half-open intervals so adjacent placements do not conflict", () => {
    const conflicts = validateAgendaConflicts(bounds, [
      placement("first", "2027-03-14T17:00:00Z", "2027-03-14T18:00:00Z", {
        roomId: "room-a",
        trackIds: ["track-a"],
        speakerIds: ["speaker-a"],
      }),
      placement("second", "2027-03-14T18:00:00Z", "2027-03-14T19:00:00Z", {
        roomId: "room-a",
        trackIds: ["track-a"],
        speakerIds: ["speaker-a"],
      }),
    ]);

    assert.deepEqual(conflicts, []);
  });

  test("reports containment and identical intervals once per shared resource", () => {
    const conflicts = validateAgendaConflicts(bounds, [
      placement("outer", "2027-03-14T17:00:00Z", "2027-03-14T20:00:00Z", {
        roomId: "room-a",
        trackIds: ["track-b", "track-a"],
      }),
      placement("inner", "2027-03-14T18:00:00Z", "2027-03-14T19:00:00Z", {
        roomId: "room-a",
        trackIds: ["track-a", "track-b"],
        speakerIds: ["speaker-a"],
      }),
      placement("same", "2027-03-14T18:00:00Z", "2027-03-14T19:00:00Z", {
        roomId: "room-b",
        speakerIds: ["speaker-a"],
      }),
    ]);

    assert.deepEqual(compact(conflicts), [
      {
        type: "room",
        placementIds: ["inner", "outer"],
        resourceId: "room-a",
        overlap: ["2027-03-14T18:00:00.000Z", "2027-03-14T19:00:00.000Z"],
      },
      {
        type: "track",
        placementIds: ["inner", "outer"],
        resourceId: "track-a",
        overlap: ["2027-03-14T18:00:00.000Z", "2027-03-14T19:00:00.000Z"],
      },
      {
        type: "track",
        placementIds: ["inner", "outer"],
        resourceId: "track-b",
        overlap: ["2027-03-14T18:00:00.000Z", "2027-03-14T19:00:00.000Z"],
      },
      {
        type: "speaker",
        placementIds: ["inner", "same"],
        resourceId: "speaker-a",
        overlap: ["2027-03-14T18:00:00.000Z", "2027-03-14T19:00:00.000Z"],
      },
    ]);
  });

  test("finds speaker conflicts across rooms and all simultaneous conflict types", () => {
    const conflicts = validateAgendaConflicts(bounds, [
      placement("alpha", "2027-03-14T17:00:00Z", "2027-03-14T18:30:00Z", {
        roomId: "room-a",
        trackIds: ["track-a"],
        speakerIds: ["speaker-a", "speaker-b"],
      }),
      placement("beta", "2027-03-14T18:00:00Z", "2027-03-14T19:00:00Z", {
        roomId: "room-b",
        trackIds: ["track-a"],
        speakerIds: ["speaker-b", "speaker-c"],
      }),
      placement("gamma", "2027-03-14T18:15:00Z", "2027-03-14T18:45:00Z", {
        roomId: "room-b",
        speakerIds: ["speaker-c"],
      }),
    ]);

    assert.deepEqual(
      compact(conflicts).map(({ type, placementIds, resourceId }) => ({ type, placementIds, resourceId })),
      [
        { type: "track", placementIds: ["alpha", "beta"], resourceId: "track-a" },
        { type: "speaker", placementIds: ["alpha", "beta"], resourceId: "speaker-b" },
        { type: "room", placementIds: ["beta", "gamma"], resourceId: "room-b" },
        { type: "speaker", placementIds: ["beta", "gamma"], resourceId: "speaker-c" },
      ],
    );
  });

  test("reports each portion outside the event bounds", () => {
    const conflicts = validateAgendaConflicts(bounds, [
      placement("early", "2027-03-14T15:30:00Z", "2027-03-14T16:30:00Z"),
      placement("late", "2027-03-14T23:30:00Z", "2027-03-15T00:30:00Z"),
      placement("spanning", "2027-03-14T15:00:00Z", "2027-03-15T01:00:00Z"),
    ]);

    assert.deepEqual(compact(conflicts), [
      {
        type: "event-boundary",
        placementIds: ["spanning"],
        resourceId: null,
        overlap: ["2027-03-14T15:00:00.000Z", "2027-03-14T16:00:00.000Z"],
      },
      {
        type: "event-boundary",
        placementIds: ["early"],
        resourceId: null,
        overlap: ["2027-03-14T15:30:00.000Z", "2027-03-14T16:00:00.000Z"],
      },
      {
        type: "event-boundary",
        placementIds: ["late"],
        resourceId: null,
        overlap: ["2027-03-15T00:00:00.000Z", "2027-03-15T00:30:00.000Z"],
      },
      {
        type: "event-boundary",
        placementIds: ["spanning"],
        resourceId: null,
        overlap: ["2027-03-15T00:00:00.000Z", "2027-03-15T01:00:00.000Z"],
      },
    ]);
  });

  test("keeps instant comparisons stable across daylight-saving time zones", () => {
    const placements = [
      placement("first", "2027-11-07T08:30:00Z", "2027-11-07T10:30:00Z", { roomId: "main" }),
      placement("second", "2027-11-07T09:30:00Z", "2027-11-07T11:00:00Z", { roomId: "main" }),
    ];
    const dstBounds = {
      startsAt: new Date("2027-11-07T07:00:00Z"),
      endsAt: new Date("2027-11-07T12:00:00Z"),
    };

    const losAngeles = validateAgendaConflicts({ ...dstBounds, timezone: "America/Los_Angeles" }, placements);
    const utc = validateAgendaConflicts({ ...dstBounds, timezone: "UTC" }, placements);

    assert.deepEqual(compact(losAngeles), compact(utc));
    assert.match(losAngeles[0]?.explanation ?? "", /America\/Los_Angeles/);
    assert.match(utc[0]?.explanation ?? "", /UTC/);
  });

  test("returns conflicts in stable order regardless of placement input order", () => {
    const placements = [
      placement("zeta", "2027-03-14T17:00:00Z", "2027-03-14T19:00:00Z", {
        roomId: "room-a",
        speakerIds: ["speaker-a"],
      }),
      placement("alpha", "2027-03-14T18:00:00Z", "2027-03-14T20:00:00Z", {
        roomId: "room-a",
        speakerIds: ["speaker-a"],
      }),
    ];

    assert.deepEqual(
      compact(validateAgendaConflicts(bounds, placements)),
      compact(validateAgendaConflicts(bounds, placements.toReversed())),
    );
  });
});
