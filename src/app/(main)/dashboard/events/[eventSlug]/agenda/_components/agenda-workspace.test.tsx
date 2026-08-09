// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
HTMLElement.prototype.scrollIntoView = vi.fn();

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
    parentSessionId: null,
    parentSessionTitle: null,
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
    parentSessionId: null,
    parentSessionTitle: null,
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

function agendaViews() {
  const card = screen.getByText("Agenda views").closest('[data-slot="card"]');
  if (!card) throw new Error("Agenda views card was not rendered.");
  return within(card as HTMLElement);
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

  test("filters scheduled and unscheduled sessions", async () => {
    renderWorkspace();
    expect(agendaViews().getByText("Opening keynote")).toBeTruthy();
    expect(agendaViews().getByText("Designing cooperative tension")).toBeTruthy();

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Unscheduled" }));
    expect(agendaViews().getByText("Opening keynote")).toBeTruthy();
    expect(agendaViews().queryByText("Designing cooperative tension")).toBeNull();

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Scheduled" }));
    expect(agendaViews().queryByText("Opening keynote")).toBeNull();
    expect(agendaViews().getByText("Designing cooperative tension")).toBeTruthy();
  });

  test("snaps pointer resize to 15 minutes and persists through the placement action", async () => {
    renderWorkspace();
    const resizeHandle = screen.getByRole("button", { name: "Resize Designing cooperative tension" });
    fireEvent.pointerDown(resizeHandle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(resizeHandle, { clientY: 118, pointerId: 1 });
    await act(async () => {
      fireEvent.pointerUp(resizeHandle, { clientY: 118, pointerId: 1 });
    });

    await waitFor(() => expect(actionMocks.saveAgendaPlacement).toHaveBeenCalled());
    const formData = actionMocks.saveAgendaPlacement.mock.calls[0]?.[1] as FormData;
    expect(formData.get("placementId")).toBe(LAB_PLACEMENT_ID);
    expect(formData.get("durationMinutes")).toBe("75");
    expect(formData.get("expectedVersion")).toBe("2");
    expect(await screen.findByText("Schedule updated")).toBeTruthy();

    fireEvent.pointerDown(resizeHandle, { clientY: 100, pointerId: 2 });
    fireEvent.pointerMove(resizeHandle, { clientY: 118, pointerId: 2 });
    await act(async () => {
      fireEvent.pointerUp(resizeHandle, { clientY: 118, pointerId: 2 });
    });
    await waitFor(() => expect(actionMocks.saveAgendaPlacement).toHaveBeenCalledTimes(2));
    const sequentialFormData = actionMocks.saveAgendaPlacement.mock.calls[1]?.[1] as FormData;
    expect(sequentialFormData.get("durationMinutes")).toBe("90");
    expect(sequentialFormData.get("expectedVersion")).toBe("3");
  });

  test("reverts a failed resize and explains the failure", async () => {
    actionMocks.saveAgendaPlacement.mockResolvedValueOnce({
      status: "error",
      message: "The agenda placement changed; reload it before saving again.",
    });
    const { container } = renderWorkspace();
    const resizeHandle = screen.getByRole("button", { name: "Resize Designing cooperative tension" });
    fireEvent.pointerDown(resizeHandle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(resizeHandle, { clientY: 136, pointerId: 1 });
    await act(async () => {
      fireEvent.pointerUp(resizeHandle, { clientY: 136, pointerId: 1 });
    });

    expect(await screen.findByText("Schedule change not saved")).toBeTruthy();
    expect(screen.getByText(/Change reverted/)).toBeTruthy();
    const card = container.querySelector(`[data-agenda-session="${LAB_ID}"]`);
    expect(card?.textContent).toContain("60 min");
  });

  test("switches among date, track, and room views while preserving filters", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Scheduled" }));

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Day" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("Saturday, March 13, 2027")).toBeTruthy();
    expect(agendaViews().getByText("Designing cooperative tension")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Week" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("Mar 8–Mar 14, 2027")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Month" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("March 2027")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Track" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("heading", { name: "Game design" })).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Room" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("heading", { name: "Main Hall" })).toBeTruthy();
    expect(agendaViews().queryByText("Opening keynote")).toBeNull();
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
