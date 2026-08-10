import "server-only";

import { cache } from "react";

import { cookies, headers } from "next/headers";

import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";

import { resolveMembershipPrincipal } from "./membership-principal";

export const ACTIVE_ORGANIZATION_COOKIE = "board_to_death_active_org";

export const getRequestAuthorization = cache(async () => {
  const [session, cookieStore] = await Promise.all([auth.api.getSession({ headers: await headers() }), cookies()]);
  if (!session) return null;

  const membership = await resolveMembershipPrincipal(getDatabaseClient(), session.user.id);
  const requestedOrganizationId = cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const activeOrganization =
    membership.organizations.find(({ id }) => id === requestedOrganizationId) ?? membership.organizations[0] ?? null;

  return { session, ...membership, activeOrganization } as const;
});

export async function getRequestPrincipal() {
  return (await getRequestAuthorization())?.principal ?? null;
}
