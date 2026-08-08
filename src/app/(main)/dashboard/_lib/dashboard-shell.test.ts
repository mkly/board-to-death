import { describe, expect, test } from "vitest";

import {
  dashboardEventHref,
  dashboardWorkspaceTitle,
  getSidebarItems,
  isDashboardWorkspace,
} from "@/navigation/sidebar/sidebar-items";

import { type DashboardEvent, findAuthorizedEvent, resolveActiveEvent } from "./dashboard-shell";

const events: readonly DashboardEvent[] = [
  {
    id: "event-a",
    name: "Tabletop Summit",
    slug: "tabletop-summit",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2026-09-01T16:00:00Z"),
    endsAt: new Date("2026-09-03T23:00:00Z"),
  },
  {
    id: "event-b",
    name: "Indie Games Night",
    slug: "indie-games-night",
    timezone: "America/New_York",
    startsAt: new Date("2026-10-08T22:00:00Z"),
    endsAt: new Date("2026-10-09T02:00:00Z"),
  },
];

describe("dashboard shell event scope", () => {
  test("restores an authorized selected event and safely falls back from a forged identifier", () => {
    expect(resolveActiveEvent(events, "event-b")?.slug).toBe("indie-games-night");
    expect(resolveActiveEvent(events, "another-event")?.slug).toBe("tabletop-summit");
  });

  test("represents an administrator with no event access as an empty shell", () => {
    expect(resolveActiveEvent([], "event-a")).toBeNull();
    expect(getSidebarItems()[0]?.items.every((item) => item.disabled)).toBe(true);
  });

  test("does not resolve unauthorized event routes", () => {
    expect(findAuthorizedEvent(events, "indie-games-night")?.id).toBe("event-b");
    expect(findAuthorizedEvent(events, "private-event")).toBeNull();
  });
});

describe("program workspace navigation", () => {
  test("provides every supported workspace with event-scoped routes", () => {
    const navigation = getSidebarItems("tabletop-summit")[0]?.items ?? [];

    expect(navigation.map(({ id }) => id)).toEqual([
      "overview",
      "cfp",
      "submissions",
      "sessions",
      "speakers",
      "onboarding",
      "communications",
      "evaluations",
      "agenda",
      "publishing",
      "integrations",
      "settings",
    ]);
    expect(navigation.every((item) => "url" in item && item.url.startsWith("/dashboard/events/tabletop-summit/"))).toBe(
      true,
    );
  });

  test("validates workspace segments before using them in a route", () => {
    expect(isDashboardWorkspace("agenda")).toBe(true);
    expect(isDashboardWorkspace("billing")).toBe(false);
    expect(dashboardWorkspaceTitle("communications")).toBe("Communications");
    expect(dashboardEventHref("indie games", "overview")).toBe("/dashboard/events/indie%20games/overview");
  });
});
