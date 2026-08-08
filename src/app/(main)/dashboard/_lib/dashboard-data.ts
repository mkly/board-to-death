import "server-only";

import { cache } from "react";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";

import { ACTIVE_EVENT_COOKIE, type DashboardEvent, resolveActiveEvent } from "./dashboard-shell";

export interface DashboardShellData {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly avatar: string;
  };
  readonly events: readonly DashboardEvent[];
  readonly activeEvent: DashboardEvent | null;
}

export const getDashboardShellData = cache(async (): Promise<DashboardShellData> => {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!isAuthorizedAdminSession(session)) {
    redirect("/auth/v1/login");
  }

  const events = await getDatabaseClient().event.findMany({ orderBy: [{ startsAt: "asc" }, { name: "asc" }] });

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      avatar: session.user.image ?? "",
    },
    events,
    activeEvent: resolveActiveEvent(events, cookieStore.get(ACTIVE_EVENT_COOKIE)?.value),
  };
});
