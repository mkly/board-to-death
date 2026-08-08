// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventType } from "@/generated/prisma/client";

import type { EventSettingsSnapshot, MutationResult } from "../types";

const actionMocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  createRoom: vi.fn(),
  createTrack: vi.fn(),
  deleteRoom: vi.fn(),
  deleteTrack: vi.fn(),
  moveRoom: vi.fn(),
  moveTrack: vi.fn(),
  updateEvent: vi.fn(),
  updateRoom: vi.fn(),
  updateTrack: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../actions", () => actionMocks);

import { EventSettingsWorkspace } from "./event-settings-workspace";

class ResizeObserverStub {
  observe(): void {
    // Intentionally empty: jsdom does not implement ResizeObserver.
  }
  unobserve(): void {
    // Intentionally empty: jsdom does not implement ResizeObserver.
  }
  disconnect(): void {
    // Intentionally empty: jsdom does not implement ResizeObserver.
  }
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  releasePointerCapture: { configurable: true, value: () => undefined },
  scrollIntoView: { configurable: true, value: () => undefined },
  setPointerCapture: { configurable: true, value: () => undefined },
});

const firstSnapshot: EventSettingsSnapshot = {
  event: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Board to Death 2027",
    slug: "board-to-death-2027",
    type: EventType.CONFERENCE,
    websiteUrl: null,
    location: "Portland",
    timezone: "America/Los_Angeles",
    startsAt: "2027-09-12T16:00:00.000Z",
    endsAt: "2027-09-14T01:00:00.000Z",
    theme: null,
    exhibitorsEnabled: false,
    sponsorsEnabled: false,
    logoObjectKey: null,
    backgroundObjectKey: null,
  },
  rooms: [
    { id: "room-2", name: "Workshop Stage", sortOrder: 0 },
    { id: "room-1", name: "Main Hall", sortOrder: 1 },
  ],
  tracks: [
    { id: "track-2", name: "Design", color: "violet", sortOrder: 0 },
    { id: "track-1", name: "Board Games", color: "slate", sortOrder: 1 },
  ],
};

const eventOptions = [
  { id: firstSnapshot.event.id, name: firstSnapshot.event.name },
  { id: "22222222-2222-4222-8222-222222222222", name: "Side Quest Summit" },
];

describe("EventSettingsWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  test("renders persisted room and track ordering and navigates between isolated events", () => {
    render(<EventSettingsWorkspace eventOptions={eventOptions} initialSnapshot={firstSnapshot} />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rooms & tracks" }), { button: 0 });

    const roomNames = screen
      .getAllByRole("textbox", { name: "Room name" })
      .map((input) => (input as HTMLInputElement).value);
    const trackNames = screen
      .getAllByRole("textbox", { name: "Track name" })
      .map((input) => (input as HTMLInputElement).value);
    expect(roomNames).toEqual(["Workshop Stage", "Main Hall"]);
    expect(trackNames).toEqual(["Design", "Board Games"]);
    expect(screen.getByRole("combobox", { name: "Design color" }).textContent).toContain("Violet");

    fireEvent.click(screen.getByRole("combobox", { name: "Select event" }));
    fireEvent.click(screen.getByRole("option", { name: "Side Quest Summit" }));
    expect(push).toHaveBeenCalledWith("/dashboard/event-settings?event=22222222-2222-4222-8222-222222222222");
  });

  test("renders field-level server validation and applies a successful room snapshot", async () => {
    const validation: MutationResult = {
      ok: false,
      message: "Review the highlighted fields.",
      fieldErrors: {
        timezone: ["Enter a valid IANA time zone."],
        endsAt: ["End must be later than start."],
      },
    };
    actionMocks.updateEvent.mockResolvedValue(validation);
    actionMocks.createRoom.mockResolvedValue({
      ok: true,
      message: "Room added.",
      snapshot: {
        ...firstSnapshot,
        rooms: [...firstSnapshot.rooms, { id: "room-3", name: "Quiet Room", sortOrder: 2 }],
      },
    });
    render(<EventSettingsWorkspace eventOptions={eventOptions} initialSnapshot={firstSnapshot} />);

    const eventForm = screen.getByRole("button", { name: "Save changes" }).closest("form");
    expect(eventForm).not.toBeNull();
    await act(async () => {
      fireEvent.submit(eventForm as HTMLFormElement);
    });
    expect(await screen.findByText("Enter a valid IANA time zone.")).toBeTruthy();
    expect(screen.getByText("End must be later than start.")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rooms & tracks" }), { button: 0 });
    const newRoom = screen.getByRole("textbox", { name: "New room name" });
    fireEvent.change(newRoom, { target: { value: "Quiet Room" } });
    await act(async () => {
      fireEvent.submit(newRoom.closest("form") as HTMLFormElement);
    });
    await waitFor(() => expect(screen.getByDisplayValue("Quiet Room")).toBeTruthy());
    expect(actionMocks.createRoom).toHaveBeenCalledWith(firstSnapshot.event.id, expect.any(FormData));
  });
});
