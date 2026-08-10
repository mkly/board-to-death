import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import OrganizationInvitationPage from "./page";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  preview: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/server/database/client", () => ({ getDatabaseClient: vi.fn(() => ({})) }));
vi.mock("@/server/organization-memberships/organization-invitations", () => ({
  OrganizationInvitationService: class {
    preview = mocks.preview;
  },
}));

describe("organization invitation page", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["accepted", "Invitation already accepted"],
    ["expired", "Invitation expired"],
    ["revoked", "Invitation revoked"],
    ["unknown", "Invitation not found"],
  ] as const)("renders a terminal message for a %s invitation", async (state, title) => {
    mocks.preview.mockResolvedValue({ state });

    const view = await OrganizationInvitationPage({
      params: Promise.resolve({ token: "invitation-token" }),
      searchParams: Promise.resolve({}),
    });
    expect(renderToStaticMarkup(view)).toContain(title);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("sends an unauthenticated invitee to login with the invitation as callback", async () => {
    mocks.preview.mockResolvedValue({
      state: "pending",
      email: "invitee@example.test",
      organizationName: "Program Committee",
      role: "MEMBER",
    });
    mocks.getSession.mockResolvedValue(null);

    await expect(
      OrganizationInvitationPage({
        params: Promise.resolve({ token: "token/with spaces" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(
      "redirect:/auth/v1/login?callbackURL=%2Forganization-invitations%2Ftoken%252Fwith%2520spaces",
    );
  });
});
