import "server-only";

import { cache } from "react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { organizerEventIds } from "@/server/authorization/policy";
import { getRequestAuthorization } from "@/server/authorization/request-context";
import { getDatabaseClient } from "@/server/database/client";

import {
  ACTIVE_EVENT_COOKIE,
  type DashboardEvent,
  type DashboardOrganization,
  resolveActiveEvent,
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
  const [authorization, cookieStore] = await Promise.all([getRequestAuthorization(), cookies()]);

  if (!authorization) {
    redirect("/auth/v1/login");
  }

  const authorizedEventIds = organizerEventIds(authorization.principal);

  const authorizedEvents = await getDatabaseClient().event.findMany({
    where: { id: { in: [...authorizedEventIds] }, archivedAt: null },
    orderBy: [{ startsAt: "asc" }, { name: "asc" }],
  });

  // An invited event-only organizer reaches an event whose organization they are not a member of,
  // so the active-organization filter applies only to organizations they can actually switch between.
  const activeOrganizationId = authorization.activeOrganization?.id;
  const memberOrganizationIds = new Set(authorization.organizations.map(({ id }) => id));
  const events = activeOrganizationId
    ? authorizedEvents.filter(
        (event) => event.orgId === activeOrganizationId || !memberOrganizationIds.has(event.orgId),
      )
    : authorizedEvents;

  return {
    user: {
      id: authorization.session.user.id,
      name: authorization.session.user.name,
      email: authorization.session.user.email,
      avatar: authorization.session.user.image ?? "",
    },
    events,
    activeEvent: resolveActiveEvent(events, cookieStore.get(ACTIVE_EVENT_COOKIE)?.value),
    organizations: authorization.organizations,
    activeOrganization: authorization.activeOrganization,
  };
});
