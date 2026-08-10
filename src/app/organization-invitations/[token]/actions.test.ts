import { afterEach, describe, expect, it, vi } from "vitest";

import { ACTIVE_ORGANIZATION_COOKIE } from "@/server/authorization/request-context";

import { acceptOrganizationInvitation } from "./actions";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  cookieSet: vi.fn(),
  getSession: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.cookieSet })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/server/database/client", () => ({ getDatabaseClient: vi.fn(() => ({})) }));
vi.mock("@/server/organization-memberships/organization-invitations", () => ({
  OrganizationInvitationService: class {
    accept = mocks.accept;
  },
}));

describe("acceptOrganizationInvitation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication and preserves the invitation callback", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(acceptOrganizationInvitation("token/with spaces")).rejects.toThrow(
      "redirect:/auth/v1/login?callbackURL=%2Forganization-invitations%2Ftoken%252Fwith%2520spaces",
    );
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("activates the accepted organization before opening the dashboard", async () => {
    const user = { id: "user-1", email: "invitee@example.test" };
    mocks.getSession.mockResolvedValue({ user });
    mocks.accept.mockResolvedValue({ organizationId: "organization-1", role: "MEMBER" });

    await expect(acceptOrganizationInvitation("invitation-token")).rejects.toThrow("redirect:/dashboard");

    expect(mocks.accept).toHaveBeenCalledWith("invitation-token", user);
    expect(mocks.cookieSet).toHaveBeenCalledWith(ACTIVE_ORGANIZATION_COOKIE, "organization-1", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/dashboard",
      maxAge: 31_536_000,
    });
  });
});
