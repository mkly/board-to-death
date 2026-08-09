import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findEvent: vi.fn(),
  findSavedView: vi.fn(),
  getSession: vi.fn(),
  isAllowedAdminEmail: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/auth/admin-access", () => ({ isAllowedAdminEmail: mocks.isAllowedAdminEmail }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/server/database/client", () => ({
  getDatabaseClient: () => ({
    cfpSubmissionView: { findUnique: mocks.findSavedView },
    event: { findUnique: mocks.findEvent },
  }),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { email: "admin@example.test", id: "admin-1" } });
  mocks.isAllowedAdminEmail.mockReturnValue(true);
  mocks.findEvent.mockResolvedValue({ id: "event-1", slug: "event-one" });
});

describe("submission export route", () => {
  it.each([
    "http://localhost/dashboard/events/event-one/submissions/export?format=files",
    "http://localhost/dashboard/events/event-two/submissions/export?format=files&q=event-one-submission&category=outside-results",
  ])("rejects unsupported attachment bundles before querying submission data", async (url) => {
    const response = await GET(new Request(url), { params: Promise.resolve({ eventSlug: "event-one" }) });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Unsupported export format");
    expect(mocks.findSavedView).not.toHaveBeenCalled();
  });
});
