import { describe, test } from "vitest";

import { type AgendaProposalPlacement, type AgendaProposalSession, proposeAgendaSchedule } from "./proposals.ts";
import assert from "node:assert/strict";

const bounds = {
  startsAt: new Date("2027-03-14T16:00:00.000Z"),
  endsAt: new Date("2027-03-14T20:00:00.000Z"),
};
const rooms = [
  { id: "room-a", name: "Main Hall" },
  { id: "room-b", name: "Workshop" },
];

function session(id: string, details: Partial<AgendaProposalSession> = {}): AgendaProposalSession {
  return {
    id,
    title: id,
    durationMinutes: 60,
    parentSessionId: null,
    trackIds: [],
    speakerIds: [],
    ...details,
  };
}

function placement(
  sessionId: string,
  startsAt: string,
  endsAt: string,
  details: Partial<AgendaProposalPlacement> = {},
): AgendaProposalPlacement {
  return {
    sessionId,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    roomId: "room-a",
    trackIds: [],
    speakerIds: [],
    ...details,
  };
}

describe("assisted agenda proposals", () => {
  test("uses available rooms concurrently without creating room or speaker conflicts", () => {
    const plan = proposeAgendaSchedule(
      bounds,
      [
        session("long", { durationMinutes: 90, speakerIds: ["speaker-a"] }),
        session("same-speaker", { speakerIds: ["speaker-a"] }),
        session("other-speaker", { speakerIds: ["speaker-b"] }),
      ],
      rooms,
      [],
    );

    assert.deepEqual(
      plan.proposals.map(({ sessionId, roomId, startsAt, endsAt }) => ({
        sessionId,
        roomId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })),
      [
        {
          sessionId: "long",
          roomId: "room-a",
          startsAt: "2027-03-14T16:00:00.000Z",
          endsAt: "2027-03-14T17:30:00.000Z",
        },
        {
          sessionId: "other-speaker",
          roomId: "room-b",
          startsAt: "2027-03-14T16:00:00.000Z",
          endsAt: "2027-03-14T17:00:00.000Z",
        },
        {
          sessionId: "same-speaker",
          roomId: "room-a",
          startsAt: "2027-03-14T17:30:00.000Z",
          endsAt: "2027-03-14T18:30:00.000Z",
        },
      ],
    );
    assert.deepEqual(plan.unplaced, []);
  });

  test("accounts for existing placements and keeps every proposal inside event bounds", () => {
    const plan = proposeAgendaSchedule(
      bounds,
      [session("existing"), session("candidate", { durationMinutes: 180 })],
      rooms.slice(0, 1),
      [placement("existing", "2027-03-14T16:00:00.000Z", "2027-03-14T18:00:00.000Z")],
    );

    assert.equal(plan.proposals.length, 0);
    assert.deepEqual(plan.unplaced, [
      {
        sessionId: "candidate",
        title: "candidate",
        reason: "No conflict-free time remains in the event window.",
      },
    ]);
  });

  test("places a subsession only within its parent and permits their intentional overlap", () => {
    const plan = proposeAgendaSchedule(
      bounds,
      [
        session("child", { durationMinutes: 45, parentSessionId: "parent", speakerIds: ["speaker-a"] }),
        session("parent", { durationMinutes: 90, speakerIds: ["speaker-a"] }),
      ],
      rooms.slice(0, 1),
      [],
    );

    assert.deepEqual(
      plan.proposals.map(({ sessionId, startsAt, endsAt }) => [
        sessionId,
        startsAt.toISOString(),
        endsAt.toISOString(),
      ]),
      [
        ["parent", "2027-03-14T16:00:00.000Z", "2027-03-14T17:30:00.000Z"],
        ["child", "2027-03-14T16:00:00.000Z", "2027-03-14T16:45:00.000Z"],
      ],
    );
  });
});
