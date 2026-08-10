"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth/auth";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/server/authorization/request-context";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { OrganizationInvitationService } from "@/server/organization-memberships/organization-invitations";

const cookieLifetimeSeconds = 60 * 60 * 24 * 365;

function invitationPath(token: string): string {
  return `/organization-invitations/${encodeURIComponent(token)}`;
}

export async function acceptOrganizationInvitation(token: string): Promise<never> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect(`/auth/v1/login?callbackURL=${encodeURIComponent(invitationPath(token))}`);
  }

  let organizationId: string;
  try {
    const accepted = await new OrganizationInvitationService(getDatabaseClient()).accept(token, session.user);
    organizationId = accepted.organizationId;
  } catch (error) {
    const message =
      error instanceof RepositoryError
        ? error.message
        : "The invitation could not be accepted. Ask the organization owner for a new link.";
    redirect(`${invitationPath(token)}?error=${encodeURIComponent(message)}`);
  }

  (await cookies()).set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/dashboard",
    maxAge: cookieLifetimeSeconds,
  });
  redirect("/dashboard");
}
