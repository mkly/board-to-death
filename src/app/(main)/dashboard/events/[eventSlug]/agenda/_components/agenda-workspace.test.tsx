// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  removeAgendaPlacement: vi.fn(),
  saveAgendaPlacement: vi.fn(),
}));

vi.mock("../actions", () => actionMocks);

import { AgendaWorkspace, type AgendaWorkspaceSession } from "./agenda-workspace";

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

const event = {
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
  timezone: "America/Los_Angeles",
  startsAt: "2027-03-13T17:00:00.000Z",
  endsAt: "2027-03-15T00:00:00.000Z",
  defaultStartsAtLocal: "2027-03-13T09:00",
};
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRACK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPENING_ID = "11111111-1111-4111-8111-111111111111";
const LAB_ID = "22222222-2222-4222-8222-222222222222";
const LAB_PLACEMENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const rooms = [{ id: ROOM_ID, name: "Main Hall" }];
const tracks = [{ id: TRACK_ID, name: "Game design" }];
const sessions: readonly AgendaWorkspaceSession[] = [
  {
    id: OPENING_ID,
    title: "Opening keynote",
    durationMinutes: 45,
    trackId: TRACK_ID,
    trackName: "Game design",
    speakerIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    speakerNames: ["Alex Rivera"],
    placement: null,
  },
  {
    id: LAB_ID,
    title: "Designing cooperative tension",
    durationMinutes: 60,
    trackId: TRACK_ID,
    trackName: "Game design",
    speakerIds: [],
    speakerNames: [],
    placement: {
      id: LAB_PLACEMENT_ID,
      startsAt: "2027-03-13T18:00:00.000Z",
      startsAtLocal: "2027-03-13T10:00",
      endsAt: "2027-03-13T19:00:00.000Z",
      durationMinutes: 60,
      roomId: ROOM_ID,
      roomName: "Main Hall",
      trackId: TRACK_ID,
      version: 2,
    },
  },
];

function renderWorkspace() {
  return render(<AgendaWorkspace event={event} sessions={sessions} rooms={rooms} tracks={tracks} />);
}

describe("AgendaWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.saveAgendaPlacement.mockResolvedValue({
      status: "success",
      message: "Session added to the agenda.",
      sessionId: OPENING_ID,
    });
    actionMocks.removeAgendaPlacement.mockResolvedValue({
      status: "success",
      message: "Session removed from the agenda.",
    });
  });
  afterEach(cleanup);

  test("filters scheduled and unscheduled sessions", () => {
    renderWorkspace();
    expect(screen.getByText("Opening keynote")).toBeTruthy();
    expect(screen.getByText("Designing cooperative tension")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Unscheduled" }));
    expect(screen.getByText("Opening keynote")).toBeTruthy();
    expect(screen.queryByText("Designing cooperative tension")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Scheduled" }));
    expect(screen.queryByText("Opening keynote")).toBeNull();
    expect(screen.getByText("Designing cooperative tension")).toBeTruthy();
  });

  test("submits keyboard-accessible placement fields", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Schedule Opening keynote" }));
    fireEvent.change(screen.getByLabelText("Starts at"), { target: { value: "2027-03-13T11:30" } });
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "50" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Add to agenda" }).closest("form") as HTMLFormElement);
    });

    await waitFor(() => expect(actionMocks.saveAgendaPlacement).toHaveBeenCalled());
    const formData = actionMocks.saveAgendaPlacement.mock.calls[0]?.[1] as FormData;
    expect(formData.get("sessionId")).toBe(OPENING_ID);
    expect(formData.get("startsAt")).toBe("2027-03-13T11:30");
    expect(formData.get("durationMinutes")).toBe("50");
    expect(formData.get("conflictPolicy")).toBe("prevent");
  });

  test("requires a second explicit submission after explaining conflicts", async () => {
    actionMocks.saveAgendaPlacement
      .mockResolvedValueOnce({
        status: "conflict",
        message: "Review and confirm the agenda conflicts before saving.",
        confirmationRequired: true,
        values: {
          startsAt: "2027-03-13T11:30",
          durationMinutes: "45",
          roomId: ROOM_ID,
          trackId: TRACK_ID,
          conflictPolicy: "explicit-confirm",
        },
        conflicts: [
          {
            type: "room",
            placementIds: [`new:${OPENING_ID}`, LAB_PLACEMENT_ID],
            resourceId: ROOM_ID,
            startsAt: "2027-03-13T18:30:00.000Z",
            endsAt: "2027-03-13T19:00:00.000Z",
            explanation: "Room conflict",
          },
        ],
      })
      .mockResolvedValueOnce({ status: "success", message: "Session added to the agenda." });
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Schedule Opening keynote" }));
    fireEvent.click(screen.getByRole("radio", { name: "Allow after confirmation" }));
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Add to agenda" }).closest("form") as HTMLFormElement);
    });

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/Main Hall overlaps with Designing cooperative tension/)).toBeTruthy();
    expect((screen.getByLabelText("Starts at") as HTMLInputElement).value).toBe("2027-03-13T11:30");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    });
    await waitFor(() => expect(actionMocks.saveAgendaPlacement).toHaveBeenCalledTimes(2));
    const confirmedFormData = actionMocks.saveAgendaPlacement.mock.calls[1]?.[1] as FormData;
    expect(confirmedFormData.get("conflictsConfirmed")).toBe("true");
  });
});
