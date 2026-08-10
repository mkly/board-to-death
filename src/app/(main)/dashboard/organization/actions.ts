"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { MembershipStatus, OrganizationMemberRole } from "@/generated/prisma/client";
import { auth } from "@/server/auth/auth";
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

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function destination(result: { readonly notice?: string; readonly error?: string }): string {
  const query = new URLSearchParams();
  if (result.notice) query.set("notice", result.notice);
  if (result.error) query.set("error", result.error);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `/dashboard/organization${suffix}`;
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
    await auth.api.signInMagicLink({
      headers: requestHeaders,
      body: { email, callbackURL, newUserCallbackURL: callbackURL, errorCallbackURL: callbackURL },
    });
  };
}

export async function inviteOrganizationMember(organizationId: string, formData: FormData): Promise<never> {
  const parsed = inviteSchema.safeParse({
    email: field(formData, "email").trim().toLowerCase(),
    role: field(formData, "role"),
  });
  if (!parsed.success) {
    redirect(destination({ error: parsed.error.issues[0]?.message ?? "Review the invitation." }));
  }

  let result: { readonly notice?: string; readonly error?: string };
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
    result = { notice: `Invitation sent to ${parsed.data.email}.` };
  } catch (error) {
    result = { error: errorMessage(error) };
  }
  redirect(destination(result));
}

export async function resendOrganizationInvitation(organizationId: string, invitationId: string): Promise<never> {
  let result: { readonly notice?: string; readonly error?: string };
  try {
    const owner = await requireOrganizationOwner(organizationId);
    await new OrganizationInvitationService(getDatabaseClient()).resend(
      owner.organizationId,
      invitationId,
      await magicLinkDelivery(),
    );
    result = { notice: "Invitation sent again with a fresh link." };
  } catch (error) {
    result = { error: errorMessage(error) };
  }
  redirect(destination(result));
}

export async function revokeOrganizationInvitation(organizationId: string, invitationId: string): Promise<never> {
  let result: { readonly notice?: string; readonly error?: string };
  try {
    const owner = await requireOrganizationOwner(organizationId);
    await new OrganizationInvitationService(getDatabaseClient()).revoke(owner.organizationId, invitationId);
    result = { notice: "Pending invitation revoked." };
  } catch (error) {
    result = { error: errorMessage(error) };
  }
  redirect(destination(result));
}

export async function setOrganizationMembershipActive(
  organizationId: string,
  membershipId: string,
  active: boolean,
): Promise<never> {
  let result: { readonly notice?: string; readonly error?: string };
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
    result = { notice: active ? "Organization access restored." : "Organization access set to inactive." };
  } catch (error) {
    result = { error: errorMessage(error) };
  }
  redirect(destination(result));
}
