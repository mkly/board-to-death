import { beforeEach, describe, expect, test, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
const dashboardDataMocks = vi.hoisted(() => ({
  getDashboardShellData: vi.fn(),
}));

vi.mock("next/navigation", () => navigationMocks);
vi.mock("server-only", () => ({}));
vi.mock("../../_lib/dashboard-data", () => dashboardDataMocks);
vi.mock("@/app/(main)/dashboard/event-settings/_components/event-settings-workspace", () => ({
  EventSettingsWorkspace: () => null,
}));
vi.mock("@/server/communications/templates", () => ({ EmailTemplateRepository: vi.fn() }));
vi.mock("@/server/database", () => ({ getDatabaseClient: vi.fn() }));
vi.mock("@/server/database/client", () => ({ getDatabaseClient: vi.fn() }));
vi.mock("@/server/events", () => ({ EventRepository: vi.fn(), RoomRepository: vi.fn(), TrackRepository: vi.fn() }));

import EmailTemplatesPage from "./communications/templates/page";
import EventSettingsPage from "./settings/page";

const activeEvent = {
  id: "event-active",
  name: "Board to Death",
  slug: "board-to-death",
  timezone: "America/Los_Angeles",
  startsAt: new Date("2027-09-12T16:00:00.000Z"),
  endsAt: new Date("2027-09-14T01:00:00.000Z"),
};
const inactiveEvent = {
  ...activeEvent,
  id: "event-inactive",
  name: "Side Quest Summit",
  slug: "side-quest-summit",
};
const shell = {
  user: { name: "Admin", email: "admin@example.com", avatar: "" },
  events: [activeEvent, inactiveEvent],
  activeEvent,
};

describe("event-specific route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardDataMocks.getDashboardShellData.mockResolvedValue(shell);
  });

  test("redirects known inactive event slugs to the active event's equivalent routes", async () => {
    await expect(EventSettingsPage({ params: Promise.resolve({ eventSlug: inactiveEvent.slug }) })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/events/board-to-death/settings",
    );
    await expect(EmailTemplatesPage({ params: Promise.resolve({ eventSlug: inactiveEvent.slug }) })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/events/board-to-death/communications/templates",
    );

    expect(navigationMocks.redirect).toHaveBeenNthCalledWith(1, "/dashboard/events/board-to-death/settings");
    expect(navigationMocks.redirect).toHaveBeenNthCalledWith(
      2,
      "/dashboard/events/board-to-death/communications/templates",
    );
    expect(navigationMocks.notFound).not.toHaveBeenCalled();
  });

  test("keeps unknown event slugs as not found on both routes", async () => {
    await expect(EventSettingsPage({ params: Promise.resolve({ eventSlug: "unknown" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    await expect(EmailTemplatesPage({ params: Promise.resolve({ eventSlug: "unknown" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(navigationMocks.notFound).toHaveBeenCalledTimes(2);
    expect(navigationMocks.redirect).not.toHaveBeenCalled();
  });

  test("falls back to the dashboard when no active event is available", async () => {
    dashboardDataMocks.getDashboardShellData.mockResolvedValue({ ...shell, activeEvent: null });

    await expect(EventSettingsPage({ params: Promise.resolve({ eventSlug: inactiveEvent.slug }) })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
    await expect(EmailTemplatesPage({ params: Promise.resolve({ eventSlug: inactiveEvent.slug }) })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );

    expect(navigationMocks.redirect).toHaveBeenNthCalledWith(1, "/dashboard");
    expect(navigationMocks.redirect).toHaveBeenNthCalledWith(2, "/dashboard");
  });

  test("propagates authentication redirects from the dashboard shell loader", async () => {
    dashboardDataMocks.getDashboardShellData.mockRejectedValue(new Error("NEXT_REDIRECT:/auth/v1/login"));

    await expect(EventSettingsPage({ params: Promise.resolve({ eventSlug: activeEvent.slug }) })).rejects.toThrow(
      "NEXT_REDIRECT:/auth/v1/login",
    );
    await expect(EmailTemplatesPage({ params: Promise.resolve({ eventSlug: activeEvent.slug }) })).rejects.toThrow(
      "NEXT_REDIRECT:/auth/v1/login",
    );

    expect(dashboardDataMocks.getDashboardShellData).toHaveBeenCalledTimes(2);
  });
});
