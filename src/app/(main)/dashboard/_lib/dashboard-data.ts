import "server-only";

import { cache } from "react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

  if (!authorization?.activeOrganization) {
    redirect("/auth/v1/login");
  }

  const events = await getDatabaseClient().event.findMany({
    where: { orgId: authorization.activeOrganization.id, archivedAt: null },
    orderBy: [{ startsAt: "asc" }, { name: "asc" }],
  });

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
