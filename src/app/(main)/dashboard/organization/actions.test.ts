import { beforeEach, describe, expect, it, vi } from "vitest";

import { MembershipStatus, OrganizationMemberRole } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  findMembership: vi.fn(),
  getSession: vi.fn(),
  invite: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  resend: vi.fn(),
  revoke: vi.fn(),
  setMembershipActive: vi.fn(),
  signInMagicLink: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/auth/auth", () => ({
  auth: { api: { getSession: mocks.getSession, signInMagicLink: mocks.signInMagicLink } },
}));
vi.mock("@/server/database/client", () => ({
  getDatabaseClient: () => ({ organizationMember: { findFirst: mocks.findMembership } }),
}));
vi.mock("@/server/organization-memberships/organization-invitations", () => ({
  OrganizationInvitationService: class {
    readonly invite = mocks.invite;
    readonly resend = mocks.resend;
    readonly revoke = mocks.revoke;
    readonly setMembershipActive = mocks.setMembershipActive;
  },
}));

import {
  inviteOrganizationMember,
  resendOrganizationInvitation,
  revokeOrganizationInvitation,
  setOrganizationMembershipActive,
} from "./actions";

const organizationId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-user";

function invitationForm(): FormData {
  const formData = new FormData();
  formData.set("email", "new-member@example.test");
  formData.set("role", OrganizationMemberRole.MEMBER);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: ownerId } });
  mocks.findMembership.mockResolvedValue({ userId: ownerId, organization: { id: organizationId } });
});

describe("organization team actions", () => {
  it("allows an active owner to invite a member", async () => {
    await expect(inviteOrganizationMember(organizationId, invitationForm())).rejects.toThrow(
      "REDIRECT:/dashboard/organization?notice=Invitation+sent+to+new-member%40example.test.",
    );

    expect(mocks.findMembership).toHaveBeenCalledWith({
      where: {
        orgId: organizationId,
        userId: ownerId,
        role: OrganizationMemberRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
      select: { userId: true, organization: { select: { id: true } } },
    });
    expect(mocks.invite).toHaveBeenCalledWith(
      {
        organizationId,
        inviterId: ownerId,
        email: "new-member@example.test",
        role: OrganizationMemberRole.MEMBER,
      },
      expect.any(Function),
    );
  });

  it.each([
    ["invite", () => inviteOrganizationMember(organizationId, invitationForm())],
    ["resend", () => resendOrganizationInvitation(organizationId, "invitation-id")],
    ["revoke", () => revokeOrganizationInvitation(organizationId, "invitation-id")],
    ["membership access", () => setOrganizationMembershipActive(organizationId, "membership-id", false)],
  ])("refuses the %s action for a member without owner access", async (_name, action) => {
    mocks.findMembership.mockResolvedValue(null);

    await expect(action()).rejects.toThrow(
      "REDIRECT:/dashboard/organization?error=Organization+owner+access+is+required.",
    );
    expect(mocks.invite).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.setMembershipActive).not.toHaveBeenCalled();
  });

  it("refuses an organization action for an unauthenticated non-member", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(revokeOrganizationInvitation(organizationId, "invitation-id")).rejects.toThrow(
      "REDIRECT:/dashboard/organization?error=Organization+owner+access+is+required.",
    );
    expect(mocks.findMembership).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("does not allow an owner to deactivate their own membership", async () => {
    mocks.findMembership
      .mockResolvedValueOnce({ userId: ownerId, organization: { id: organizationId } })
      .mockResolvedValueOnce({ userId: ownerId });

    await expect(setOrganizationMembershipActive(organizationId, "membership-id", false)).rejects.toThrow(
      "REDIRECT:/dashboard/organization?error=You+cannot+remove+your+own+organization+access.",
    );
    expect(mocks.setMembershipActive).not.toHaveBeenCalled();
  });
});
