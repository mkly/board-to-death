import ICAL from "ical.js";
import { describe, test } from "vitest";

import { createPublishedItineraryCalendar, handlePublishedItineraryCalendarRequest } from "./itinerary-calendar.ts";
import type { PublishedProgramSnapshot } from "./repositories.ts";
import assert from "node:assert/strict";

const snapshot: PublishedProgramSnapshot = {
  schemaVersion: 1,
  event: {
    id: "event-1",
    name: "Board Summit",
    slug: "board-summit",
    websiteUrl: null,
    location: "Oakland Convention Center",
    timezone: "America/Los_Angeles",
    startsAt: "2027-03-14T08:00:00.000Z",
    endsAt: "2027-03-15T00:00:00.000Z",
    theme: null,
  },
  rooms: [
    { id: "room-1", name: "Main Hall", sortOrder: 0 },
    { id: "room-2", name: "Garden Room", sortOrder: 1 },
  ],
  tracks: [],
  speakers: [],
  sessions: [
    {
      id: "session-1",
      title: "Opening remarks",
      description: "Welcome to the summit.",
      durationMinutes: 45,
      trackId: null,
      speakerIds: [],
    },
    {
      id: "session-2",
      title: "Designing better boards",
      description: null,
      durationMinutes: 60,
      trackId: null,
      speakerIds: [],
    },
  ],
  placements: [
    {
      id: "placement-1",
      sessionId: "session-1",
      roomId: "room-1",
      startsAt: "2027-03-14T09:30:00.000Z",
      endsAt: "2027-03-14T10:15:00.000Z",
      trackIds: [],
      speakerIds: [],
    },
    {
      id: "placement-2",
      sessionId: "session-2",
      roomId: "room-2",
      startsAt: "2027-03-14T18:00:00.000Z",
      endsAt: "2027-03-14T19:00:00.000Z",
      trackIds: [],
      speakerIds: [],
    },
  ],
};

function localParts(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

describe("published itinerary calendar", () => {
  test("exports exactly the selected placement with instants that render in the event timezone", () => {
    const result = createPublishedItineraryCalendar(snapshot, ["placement-2"], new Date("2027-02-01T12:00:00.000Z"));
    const calendar = new ICAL.Component(ICAL.parse(result.content));
    const components = calendar.getAllSubcomponents("vevent");

    assert.equal(result.eventCount, 1);
    assert.equal(components.length, 1);
    const event = new ICAL.Event(components[0]);
    assert.equal(event.uid, "placement-2.event-1@board-to-death");
    assert.equal(event.summary, "Designing better boards");
    assert.equal(event.location, "Garden Room");
    assert.equal(event.startDate.toJSDate().toISOString(), "2027-03-14T18:00:00.000Z");
    assert.equal(event.endDate.toJSDate().toISOString(), "2027-03-14T19:00:00.000Z");
    assert.equal(localParts(event.startDate.toJSDate(), snapshot.event.timezone), "2027-03-14 11:00");
    assert.equal(localParts(event.endDate.toJSDate(), snapshot.event.timezone), "2027-03-14 12:00");
  });

  test("serves a download and rejects selections absent from the current publication", async () => {
    const reader = {
      findPublic: () =>
        Promise.resolve({
          status: "published" as const,
          version: { versionNumber: 1, snapshot, createdAt: new Date("2027-02-01T12:00:00.000Z") },
        }),
    };
    const response = await handlePublishedItineraryCalendarRequest(
      new Request("https://example.test/embed/board-summit/itinerary.ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placementIds: ["placement-1"] }),
      }),
      "board-summit",
      reader,
    );
    const stale = await handlePublishedItineraryCalendarRequest(
      new Request("https://example.test/embed/board-summit/itinerary.ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placementIds: ["removed-placement"] }),
      }),
      "board-summit",
      reader,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/calendar; charset=utf-8");
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="board-summit-itinerary.ics"');
    assert.equal(new ICAL.Component(ICAL.parse(await response.text())).getAllSubcomponents("vevent").length, 1);
    assert.equal(stale.status, 400);
  });
});
