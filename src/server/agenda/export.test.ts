import { describe, expect, test } from "vitest";

import { createAgendaCsv } from "./export";

describe("createAgendaCsv", () => {
  test("includes stable identifiers, UTC instants, local labels, and formula-safe names", () => {
    const csv = new TextDecoder().decode(
      createAgendaCsv(
        [
          {
            id: "placement-1",
            sessionId: "session-1",
            sessionTitle: "=SUM(1,1)",
            startsAt: new Date("2027-03-14T09:30:00.000Z"),
            endsAt: new Date("2027-03-14T10:15:00.000Z"),
            roomId: "room-1",
            roomName: "Main Hall",
            trackIds: ["track-1"],
            trackNames: ["Game design"],
            speakerIds: ["speaker-1"],
            speakerNames: ["Alex Rivera"],
          },
        ],
        "America/Los_Angeles",
      ),
    );

    expect(csv).toContain('"session-1","placement-1","\'=SUM(1,1)"');
    expect(csv).toContain('"2027-03-14T09:30:00.000Z"');
    expect(csv).toContain('"2027-03-14T01:30:00"');
    expect(csv).toContain('"room-1","Main Hall","track-1","Game design","speaker-1","Alex Rivera"');
  });
});
