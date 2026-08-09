// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { MutationResult, OnboardingSnapshot } from "../types";

const actionMocks = vi.hoisted(() => ({
  archiveDefinition: vi.fn(),
  createDefinition: vi.fn(),
  duplicateDefinition: vi.fn(),
  moveDefinition: vi.fn(),
  updateDefinition: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../actions", () => actionMocks);

import { OnboardingTasksWorkspace } from "./onboarding-tasks-workspace";

class ResizeObserverStub {
  observe(): void {
    // Intentionally empty test stub.
  }
  unobserve(): void {
    // Intentionally empty test stub.
  }
  disconnect(): void {
    // Intentionally empty test stub.
  }
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  releasePointerCapture: { configurable: true, value: () => undefined },
  scrollIntoView: { configurable: true, value: () => undefined },
  setPointerCapture: { configurable: true, value: () => undefined },
});

const eventOptions = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Board to Death 2027" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Side Quest Summit" },
];

const populatedSnapshot: OnboardingSnapshot = {
  eventId: eventOptions[0].id,
  definitions: [
    {
      id: "task-1",
      key: "biography",
      archivedAt: null,
      versionNumber: 2,
      sortOrder: 0,
      title: "Review your biography",
      description: "Confirm that the biography is current.",
      confirmedOnly: true,
      sessionKinds: ["TALK"],
      defaultDueOffsetDays: 7,
      responseType: "TEXT",
    },
    {
      id: "task-2",
      key: "headshot",
      archivedAt: null,
      versionNumber: 1,
      sortOrder: 1,
      title: "Upload a headshot",
      description: null,
      confirmedOnly: false,
      sessionKinds: [],
      defaultDueOffsetDays: null,
      responseType: "FILE",
    },
  ],
};

describe("OnboardingTasksWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  test("covers the empty state, validation feedback, creation, and event isolation navigation", async () => {
    const emptySnapshot: OnboardingSnapshot = { eventId: eventOptions[0].id, definitions: [] };
    const validation: MutationResult = {
      ok: false,
      message: "Review the highlighted fields.",
      fieldErrors: { title: ["Title is required."] },
    };
    actionMocks.createDefinition.mockResolvedValueOnce(validation).mockResolvedValueOnce({
      ok: true,
      message: "Onboarding task created.",
      snapshot: populatedSnapshot,
    });
    render(<OnboardingTasksWorkspace eventOptions={eventOptions} initialSnapshot={emptySnapshot} />);

    expect(screen.getByText("No onboarding tasks")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create first task" }));
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Create task" }).closest("form") as HTMLFormElement);
    });
    expect(await screen.findByText("Title is required.")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
      target: { value: "Review your biography" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Create task" }).closest("form") as HTMLFormElement);
    });
    expect(await screen.findByText("Review your biography")).toBeTruthy();

    fireEvent.click(screen.getByRole("combobox", { name: "Select event" }));
    fireEvent.click(screen.getByRole("option", { name: "Side Quest Summit" }));
    expect(push).toHaveBeenCalledWith(`/dashboard/onboarding-tasks?event=${eventOptions[1].id}`);
  });

  test("covers populated ordering, edits, duplication, archival, and persisted snapshots", async () => {
    actionMocks.moveDefinition.mockResolvedValue({
      ok: true,
      message: "Onboarding task order updated.",
      snapshot: { ...populatedSnapshot, definitions: [...populatedSnapshot.definitions].reverse() },
    });
    actionMocks.updateDefinition.mockResolvedValue({
      ok: true,
      message: "Onboarding task updated.",
      snapshot: {
        ...populatedSnapshot,
        definitions: populatedSnapshot.definitions.map((definition) =>
          definition.id === "task-1"
            ? { ...definition, title: "Confirm your biography", versionNumber: 3 }
            : definition,
        ),
      },
    });
    actionMocks.duplicateDefinition.mockResolvedValue({
      ok: true,
      message: "Onboarding task duplicated.",
      snapshot: populatedSnapshot,
    });
    actionMocks.archiveDefinition.mockResolvedValue({
      ok: true,
      message: "Onboarding task archived.",
      snapshot: {
        ...populatedSnapshot,
        definitions: populatedSnapshot.definitions.map((definition) =>
          definition.id === "task-2" ? { ...definition, archivedAt: "2027-01-01T00:00:00.000Z" } : definition,
        ),
      },
    });
    render(<OnboardingTasksWorkspace eventOptions={eventOptions} initialSnapshot={populatedSnapshot} />);

    fireEvent.click(screen.getByRole("button", { name: "Move Upload a headshot up" }));
    await waitFor(() => expect(actionMocks.moveDefinition).toHaveBeenCalledWith(eventOptions[0].id, "task-2", -1));

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
      target: { value: "Confirm your biography" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form") as HTMLFormElement);
    });
    expect(await screen.findByText("Confirm your biography")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Duplicate" })[0]);
    await waitFor(() => expect(actionMocks.duplicateDefinition).toHaveBeenCalled());

    fireEvent.click(screen.getAllByRole("button", { name: "Archive" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Archived tasks")).toBeTruthy();
    expect(screen.getByText("Upload a headshot")).toBeTruthy();
  });
});
