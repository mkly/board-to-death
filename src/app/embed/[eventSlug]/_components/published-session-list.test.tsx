// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { PublishedSessionList, type PublishedSessionListItem } from "./published-session-list";

const sessions: readonly PublishedSessionListItem[] = [
  {
    id: "ci",
    title: "Taming CI",
    description: "Faster builds at scale.",
    durationMinutes: 30,
    format: "Talk (30 min)",
    location: { id: "main", name: "Main Stage" },
    track: { id: "platform", name: "Platform & Infra" },
    speakers: [{ id: "priya", name: "Priya Raman" }],
  },
  {
    id: "agents",
    title: "Reliable agents",
    description: "Production verification patterns.",
    durationMinutes: 120,
    format: "Workshop (120 min)",
    location: { id: "lab", name: "Workshop Lab" },
    track: { id: "ai", name: "AI Engineering" },
    speakers: [{ id: "marcus", name: "Marcus Okafor" }],
  },
  {
    id: "docs",
    title: "Docs that answer back",
    description: null,
    durationMinutes: 10,
    format: "Lightning Talk (10 min)",
    location: { id: "room-2a", name: "Room 2A" },
    track: { id: "platform", name: "Platform & Infra" },
    speakers: [],
  },
];

function visibleTitles(): readonly string[] {
  return screen.getAllByRole("heading", { level: 2 }).map(({ textContent }) => textContent ?? "");
}

describe("PublishedSessionList", () => {
  afterEach(cleanup);

  test("combines track, format, location, and keyword filters and displays each session format", () => {
    render(
      <PublishedSessionList
        density="comfortable"
        enabledFilters={["search", "track", "format", "room"]}
        eventName="DevFlow Conf 2027"
        sessions={sessions}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Track" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Format" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Location" })).toBeTruthy();
    expect(screen.getAllByText("Talk (30 min)")).toHaveLength(2);

    fireEvent.change(screen.getByRole("combobox", { name: "Track" }), { target: { value: "platform" } });
    expect(visibleTitles()).toEqual(["Taming CI", "Docs that answer back"]);

    fireEvent.change(screen.getByRole("combobox", { name: "Format" }), { target: { value: "Talk (30 min)" } });
    expect(visibleTitles()).toEqual(["Taming CI"]);

    fireEvent.change(screen.getByRole("combobox", { name: "Location" }), { target: { value: "main" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search sessions" }), { target: { value: "Priya" } });
    expect(visibleTitles()).toEqual(["Taming CI"]);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search sessions" }), { target: { value: "Marcus" } });
    expect(screen.getByText("No matching sessions")).toBeTruthy();
  });
});
