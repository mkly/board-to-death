import { NextRequest } from "next/server";

import { beforeEach, describe, expect, test, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  findEvent: vi.fn(),
  findMemberships: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: databaseMocks.getSession } } }));
vi.mock("@/server/database/client", () => ({
  getDatabaseClient: () => ({
    event: { findUnique: databaseMocks.findEvent },
    organizationMember: { findMany: databaseMocks.findMemberships },
  }),
}));

import { proxy } from "./proxy";

describe("dashboard proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getSession.mockResolvedValue(null);
  });

  test("redirects a direct anonymous dashboard request to magic-link sign-in", async () => {
    const response = await proxy(new NextRequest("http://localhost:3000/dashboard/default"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/auth/v1/login?returnTo=%2Fdashboard%2Fdefault",
    );
  });

  test("uses the cookie only as an optimistic check", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/dashboard/default", {
        headers: { cookie: "better-auth.session_token=forged.invalid" },
      }),
    );

    expect(response.status).toBe(200);
  });

  test("returns a real 404 before streaming an event from another active organization", async () => {
    databaseMocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    databaseMocks.findEvent.mockResolvedValue({ orgId: "organization-1", memberships: [] });
    databaseMocks.findMemberships.mockResolvedValue([{ orgId: "organization-1" }, { orgId: "organization-2" }]);

    const response = await proxy(
      new NextRequest("http://localhost:3000/dashboard/events/private-event/overview", {
        headers: {
          cookie: "better-auth.session_token=session-1; gatherpulse_active_org=organization-2",
        },
      }),
    );

    expect(response.status).toBe(404);
  });

  test("allows an invited event whose organization is not one of the user's organization memberships", async () => {
    databaseMocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    databaseMocks.findEvent.mockResolvedValue({
      orgId: "inviting-organization",
      memberships: [{ id: "membership-1" }],
    });
    databaseMocks.findMemberships.mockResolvedValue([{ orgId: "organization-1" }]);

    const response = await proxy(
      new NextRequest("http://localhost:3000/dashboard/events/invited-event/overview", {
        headers: {
          cookie: "better-auth.session_token=session-1; gatherpulse_active_org=organization-1",
        },
      }),
    );

    expect(response.status).toBe(200);
  });
});
