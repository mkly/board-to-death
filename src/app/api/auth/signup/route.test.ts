import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createIntent: vi.fn(),
  provisionUser: vi.fn(),
  signInMagicLink: vi.fn(),
}));

const database = {};

vi.mock("@/server/auth/auth", () => ({ auth: { api: { signInMagicLink: mocks.signInMagicLink } } }));
vi.mock("@/server/auth/magic-link-user", () => ({ provisionMagicLinkUser: mocks.provisionUser }));
vi.mock("@/server/auth/signup-intent", () => ({
  createOrganizationSignupIntent: mocks.createIntent,
  organizationSignupCallback: (token: string) => `/auth/v1/register/complete?intent=${token}`,
}));
vi.mock("@/server/database/client", () => ({ getDatabaseClient: () => database }));

import { POST } from "./route";

describe("organization signup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createIntent.mockResolvedValue("signup-token");
    mocks.provisionUser.mockResolvedValue(undefined);
    mocks.signInMagicLink.mockResolvedValue({ status: true });
  });

  test("provisions a new user before requesting the signup magic link", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "New.Owner@Example.test", organizationName: "New Org" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.provisionUser).toHaveBeenCalledWith(database, { email: "New.Owner@Example.test" });
    expect(mocks.provisionUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signInMagicLink.mock.invocationCallOrder[0],
    );
  });
});
