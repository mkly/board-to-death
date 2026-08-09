// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  archiveProgramSession: vi.fn(),
  saveProgramSession: vi.fn(),
}));

vi.mock("../actions", () => actionMocks);

import { SessionWorkspace, type SessionWorkspaceSession } from "./session-workspace";

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

const sessions: readonly SessionWorkspaceSession[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "MANUAL",
    archived: false,
    title: "Designing cooperative tension",
    description: "A practical workshop.",
    durationMinutes: 60,
    trackId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    trackName: "Game design",
    speakerIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    speakerNames: ["Alex Rivera"],
    versionNumber: 2,
    customFieldValues: [],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "GUARANTEED",
    archived: false,
    title: "Opening keynote",
    description: null,
    durationMinutes: 45,
    trackId: null,
    trackName: null,
    speakerIds: [],
    speakerNames: [],
    versionNumber: 1,
    customFieldValues: [],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "MANUAL",
    archived: true,
    title: "Retired workshop",
    description: null,
    durationMinutes: 30,
    trackId: null,
    trackName: null,
    speakerIds: [],
    speakerNames: [],
    versionNumber: 3,
    customFieldValues: [],
  },
];

function renderWorkspace() {
  return render(
    <SessionWorkspace
      event={{ name: "Board to Death 2027", slug: "board-to-death-2027" }}
      sessions={sessions}
      tracks={[{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Game design" }]}
      customFieldDefinitions={[]}
      speakers={[{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Alex Rivera", email: "alex@example.test" }]}
    />,
  );
}

describe("SessionWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.saveProgramSession.mockResolvedValue({ status: "success", message: "Session changes saved." });
    actionMocks.archiveProgramSession.mockResolvedValue({ status: "success", message: "Session archived." });
  });
  afterEach(cleanup);

  test("filters guaranteed, manual, and archived sessions without mixing abstract submissions", () => {
    renderWorkspace();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Designing cooperative tension")).toBeTruthy();
    expect(within(table).getByText("Opening keynote")).toBeTruthy();
    expect(within(table).queryByText("Retired workshop")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Guaranteed" }));
    expect(within(table).getByText("Opening keynote")).toBeTruthy();
    expect(within(table).queryByText("Designing cooperative tension")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Archived" }));
    expect(within(table).getByText("Retired workshop")).toBeTruthy();
    expect(within(table).queryByText("Opening keynote")).toBeNull();
  });

  test("inspects and edits persisted session details", async () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Inspect Designing cooperative tension" }));
    expect(screen.getAllByText("Designing cooperative tension")).toHaveLength(2);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Designing cooperative tension");
    expect((screen.getByLabelText("Duration (minutes)") as HTMLInputElement).value).toBe("60");
    expect(screen.getByRole("checkbox", { name: /Alex Rivera/ }).getAttribute("data-state")).toBe("checked");

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Cooperative tension lab" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Save new version" }).closest("form") as HTMLFormElement);
    });
    await waitFor(() => expect(actionMocks.saveProgramSession).toHaveBeenCalled());
    const formData = actionMocks.saveProgramSession.mock.calls[0]?.[1] as FormData;
    expect(formData.get("eventSlug")).toBe("board-to-death-2027");
    expect(formData.get("sessionId")).toBe("11111111-1111-4111-8111-111111111111");
    expect(formData.get("title")).toBe("Cooperative tension lab");
  });

  test("creates a manual session and renders field-level server validation", async () => {
    actionMocks.saveProgramSession.mockResolvedValue({
      status: "error",
      message: "Review the highlighted session fields.",
      errors: { title: ["Enter a session title."], durationMinutes: ["Duration must be at least one minute."] },
    });
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "New manual session" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "0" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Create session" }).closest("form") as HTMLFormElement);
    });

    expect(await screen.findByText("Enter a session title.")).toBeTruthy();
    expect(screen.getByText("Duration must be at least one minute.")).toBeTruthy();
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBe("true");
  });
});
