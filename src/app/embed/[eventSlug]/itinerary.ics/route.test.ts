import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlePublishedItineraryCalendarRequest: vi.fn(),
  handlePublishedScheduleFeedRoute: vi.fn(),
}));

vi.mock("@/server/database/client", () => ({ getDatabaseClient: vi.fn() }));
vi.mock("@/server/published-program", () => ({ PublishedProgramRepository: vi.fn() }));
vi.mock("@/server/published-program/itinerary-calendar", () => ({
  handlePublishedItineraryCalendarRequest: mocks.handlePublishedItineraryCalendarRequest,
}));
vi.mock("@/server/published-program/public-feed-route", () => ({
  handlePublishedScheduleFeedRoute: mocks.handlePublishedScheduleFeedRoute,
}));

import { GET } from "./route";

describe("published itinerary calendar route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("serves the published schedule as an iCal feed over GET", async () => {
    const expected = new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
      headers: { "Content-Type": "text/calendar; charset=utf-8" },
    });
    mocks.handlePublishedScheduleFeedRoute.mockResolvedValue(expected);
    const request = new Request("https://example.test/embed/board-summit/itinerary.ics");

    const response = await GET(request, { params: Promise.resolve({ eventSlug: "board-summit" }) });

    expect(response).toBe(expected);
    expect(mocks.handlePublishedScheduleFeedRoute).toHaveBeenCalledWith(request, "board-summit", "ical");
  });
});
