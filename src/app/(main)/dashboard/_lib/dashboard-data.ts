import "server-only";

import { cache } from "react";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";

import {
  ACTIVE_EVENT_COOKIE,
  ACTIVE_ORGANIZATION_COOKIE,
  type DashboardEvent,
  type DashboardOrganization,
  resolveActiveEvent,
  resolveActiveOrganization,
} from "./dashboard-shell";

export interface DashboardShellData {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly avatar: string;
  };
  readonly events: readonly DashboardEvent[];
  readonly activeEvent: DashboardEvent | null;
  readonly organizations: readonly DashboardOrganization[];
  readonly activeOrganization: DashboardOrganization | null;
}

export const getDashboardShellData = cache(async (): Promise<DashboardShellData> => {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    redirect("/auth/v1/login");
  }

  const database = getDatabaseClient();
  const memberships = await database.organizationMember.findMany({
    where: { userId: session.user.id, status: "ACTIVE" },
    select: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const organizations = memberships.map(({ organization }) => organization);
  if (organizations.length === 0 && !isAuthorizedAdminSession(session)) {
    redirect("/auth/v1/login");
  }

  const activeOrganization = resolveActiveOrganization(
    organizations,
    cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value,
  );
  const events = await database.event.findMany({
    where: { archivedAt: null, ...(activeOrganization ? { orgId: activeOrganization.id } : {}) },
    orderBy: [{ startsAt: "asc" }, { name: "asc" }],
  });

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      avatar: session.user.image ?? "",
    },
    events,
    activeEvent: resolveActiveEvent(events, cookieStore.get(ACTIVE_EVENT_COOKIE)?.value),
    organizations,
    activeOrganization,
  };
});
