"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { MembershipStatus, OrganizationMemberRole } from "@/generated/prisma/enums";
import { auth } from "@/server/auth/auth";
import { provisionMagicLinkUser } from "@/server/auth/magic-link-user";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import {
  type OrganizationInvitationDelivery,
  OrganizationInvitationService,
} from "@/server/organization-memberships/organization-invitations";

const inviteSchema = z.object({
  email: z.email("Enter a valid email address."),
  role: z.enum([OrganizationMemberRole.OWNER, OrganizationMemberRole.MEMBER]),
});

export interface OrganizationTeamActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function succeed(notice: string): OrganizationTeamActionState {
  revalidatePath("/dashboard/organization");
  return { status: "success", message: notice };
}

function fail(error: unknown): OrganizationTeamActionState {
  return { status: "error", message: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  console.error(error);
  return "The organization team could not be updated. Try again.";
}

async function requireOrganizationOwner(organizationId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new RepositoryError("not-found", "Organization owner access is required.");

  const membership = await getDatabaseClient().organizationMember.findFirst({
    where: {
      orgId: organizationId,
      userId: session.user.id,
      role: OrganizationMemberRole.OWNER,
      status: MembershipStatus.ACTIVE,
    },
    select: { userId: true, organization: { select: { id: true } } },
  });
  if (!membership) throw new RepositoryError("not-found", "Organization owner access is required.");
  return { organizationId: membership.organization.id, userId: membership.userId } as const;
}

async function magicLinkDelivery(): Promise<OrganizationInvitationDelivery> {
  const requestHeaders = new Headers(await headers());
  return async ({ email, callbackURL }) => {
    await provisionMagicLinkUser(getDatabaseClient(), { email });
    await auth.api.signInMagicLink({
      headers: requestHeaders,
      body: { email, callbackURL, newUserCallbackURL: callbackURL, errorCallbackURL: callbackURL },
    });
  };
}

export async function inviteOrganizationMember(
  organizationId: string,
  _previousState: OrganizationTeamActionState,
  formData: FormData,
): Promise<OrganizationTeamActionState> {
  const parsed = inviteSchema.safeParse({
    email: field(formData, "email").trim().toLowerCase(),
    role: field(formData, "role"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Review the invitation." };
  }

  try {
    const owner = await requireOrganizationOwner(organizationId);
    await new OrganizationInvitationService(getDatabaseClient()).invite(
      {
        organizationId: owner.organizationId,
        inviterId: owner.userId,
        ...parsed.data,
      },
      await magicLinkDelivery(),
    );
  } catch (error) {
    return fail(error);
  }
  return succeed(`Invitation sent to ${parsed.data.email}.`);
}

export async function resendOrganizationInvitation(
  organizationId: string,
  invitationId: string,
): Promise<OrganizationTeamActionState> {
  try {
    const owner = await requireOrganizationOwner(organizationId);
    await new OrganizationInvitationService(getDatabaseClient()).resend(
      owner.organizationId,
      invitationId,
      await magicLinkDelivery(),
    );
  } catch (error) {
    return fail(error);
  }
  return succeed("Invitation sent again with a fresh link.");
}

export async function revokeOrganizationInvitation(
  organizationId: string,
  invitationId: string,
): Promise<OrganizationTeamActionState> {
  try {
    const owner = await requireOrganizationOwner(organizationId);
    await new OrganizationInvitationService(getDatabaseClient()).revoke(owner.organizationId, invitationId);
  } catch (error) {
    return fail(error);
  }
  return succeed("Pending invitation revoked.");
}

export async function setOrganizationMembershipActive(
  organizationId: string,
  membershipId: string,
  active: boolean,
): Promise<OrganizationTeamActionState> {
  try {
    const owner = await requireOrganizationOwner(organizationId);
    const target = await getDatabaseClient().organizationMember.findFirst({
      where: { id: membershipId, orgId: owner.organizationId },
      select: { userId: true },
    });
    if (!target) throw new RepositoryError("not-found", "That organization membership was not found.");
    if (!active && target.userId === owner.userId) {
      throw new RepositoryError("conflict", "You cannot remove your own organization access.");
    }

    await new OrganizationInvitationService(getDatabaseClient()).setMembershipActive(
      owner.organizationId,
      membershipId,
      active,
    );
  } catch (error) {
    return fail(error);
  }
  return succeed(active ? "Organization access restored." : "Organization access set to inactive.");
}
