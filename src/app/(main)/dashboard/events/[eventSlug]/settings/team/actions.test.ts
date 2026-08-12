import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findEvent: vi.fn(),
  getSession: vi.fn(),
  invite: vi.fn(),
  isAuthorizedAdminSession: vi.fn(),
  provisionUser: vi.fn(),
  resend: vi.fn(),
  signInMagicLink: vi.fn(),
}));

const database = { event: { findUnique: mocks.findEvent } };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/auth/admin-access", () => ({ isAuthorizedAdminSession: mocks.isAuthorizedAdminSession }));
vi.mock("@/server/auth/auth", () => ({
  auth: { api: { getSession: mocks.getSession, signInMagicLink: mocks.signInMagicLink } },
}));
vi.mock("@/server/auth/magic-link-user", () => ({ provisionMagicLinkUser: mocks.provisionUser }));
vi.mock("@/server/database/client", () => ({ getDatabaseClient: () => database }));
vi.mock("@/server/event-memberships", () => ({
  EventInvitationService: class {
    readonly invite = mocks.invite;
    readonly resend = mocks.resend;
  },
}));

import { inviteEventMember, resendEventInvitation } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "admin-user" } });
  mocks.isAuthorizedAdminSession.mockResolvedValue(true);
  mocks.findEvent.mockResolvedValue({ id: "event-id", slug: "event-one" });
  mocks.provisionUser.mockResolvedValue(undefined);
  mocks.signInMagicLink.mockResolvedValue({ status: true });
  mocks.invite.mockImplementation(async (_input, deliver) => {
    await deliver({ email: "invitee@example.test", name: "Invitee", callbackURL: "/invitations/token" });
  });
  mocks.resend.mockImplementation(async (_eventId, _invitationId, deliver) => {
    await deliver({ email: "invitee@example.test", name: "Invitee", callbackURL: "/invitations/new-token" });
  });
});

describe("event invitation magic links", () => {
  test("provisions a new invitee before sending the initial magic link", async () => {
    const formData = new FormData();
    formData.set("email", "invitee@example.test");
    formData.set("displayName", "Invitee");
    formData.set("role", "REVIEWER");

    await expect(inviteEventMember("event-one", { status: "idle" }, formData)).resolves.toEqual({
      status: "success",
      message: "Invitation sent to invitee@example.test.",
    });

    expect(mocks.provisionUser).toHaveBeenCalledWith(database, {
      email: "invitee@example.test",
      name: "Invitee",
    });
    expect(mocks.provisionUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signInMagicLink.mock.invocationCallOrder[0],
    );
  });

  test("provisions a missing invitee before resending a magic link", async () => {
    await expect(resendEventInvitation("event-one", "invitation-id")).resolves.toEqual({
      status: "success",
      message: "Invitation sent again with a fresh link.",
    });

    expect(mocks.provisionUser).toHaveBeenCalledWith(database, {
      email: "invitee@example.test",
      name: "Invitee",
    });
    expect(mocks.provisionUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signInMagicLink.mock.invocationCallOrder[0],
    );
  });
});
