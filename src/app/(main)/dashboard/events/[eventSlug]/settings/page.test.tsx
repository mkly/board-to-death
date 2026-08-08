// @vitest-environment jsdom
import { useState } from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findAuthorizedEvent: vi.fn(),
  getDashboardShellData: vi.fn(),
  getEvent: vi.fn(),
  listRooms: vi.fn(),
  listTracks: vi.fn(),
}));

vi.mock("@/app/(main)/dashboard/event-settings/_components/event-settings-workspace", () => ({
  EventSettingsWorkspace: ({ initialSnapshot }: { initialSnapshot: { event: { name: string } } }) => {
    const [name, setName] = useState(initialSnapshot.event.name);

    return <input aria-label="Event name" value={name} onChange={(event) => setName(event.target.value)} />;
  },
}));
vi.mock("@/server/database", () => ({ getDatabaseClient: () => ({}) }));
vi.mock("@/server/events", () => ({
  EventRepository: class {
    get = mocks.getEvent;
  },
  RoomRepository: class {
    list = mocks.listRooms;
  },
  TrackRepository: class {
    list = mocks.listTracks;
  },
}));
vi.mock("../../../_lib/dashboard-data", () => ({ getDashboardShellData: mocks.getDashboardShellData }));
vi.mock("../../../_lib/dashboard-shell", () => ({ findAuthorizedEvent: mocks.findAuthorizedEvent }));

import EventSettingsPage from "./page";

const firstEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
};
const secondEvent = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Side Quest Summit",
  slug: "side-quest-summit",
};

describe("event-scoped settings page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("remounts the workspace with the selected event snapshot after client-side navigation", async () => {
    mocks.getDashboardShellData
      .mockResolvedValueOnce({ activeEvent: firstEvent, events: [firstEvent, secondEvent] })
      .mockResolvedValueOnce({ activeEvent: secondEvent, events: [firstEvent, secondEvent] });
    mocks.findAuthorizedEvent.mockImplementation(
      (events: (typeof firstEvent)[], eventSlug: string) => events.find(({ slug }) => slug === eventSlug) ?? null,
    );
    mocks.getEvent
      .mockResolvedValueOnce({
        ...firstEvent,
        startsAt: new Date("2027-09-12T16:00:00.000Z"),
        endsAt: new Date("2027-09-14T01:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        ...secondEvent,
        startsAt: new Date("2028-05-03T15:00:00.000Z"),
        endsAt: new Date("2028-05-04T00:00:00.000Z"),
      });
    mocks.listRooms.mockResolvedValue([]);
    mocks.listTracks.mockResolvedValue([]);

    const view = render(await EventSettingsPage({ params: Promise.resolve({ eventSlug: firstEvent.slug }) }));
    fireEvent.change(screen.getByRole("textbox", { name: "Event name" }), { target: { value: "Stale name" } });
    expect(screen.getByDisplayValue("Stale name")).toBeTruthy();

    view.rerender(await EventSettingsPage({ params: Promise.resolve({ eventSlug: secondEvent.slug }) }));

    expect(screen.getByDisplayValue(secondEvent.name)).toBeTruthy();
    expect(screen.queryByDisplayValue("Stale name")).toBeNull();
    expect(mocks.getEvent).toHaveBeenNthCalledWith(1, firstEvent.id);
    expect(mocks.getEvent).toHaveBeenNthCalledWith(2, secondEvent.id);
  });
});
