import { NextResponse } from "next/server";

import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";

import { getDashboardShellData } from "../_lib/dashboard-data";
import { ACTIVE_EVENT_COOKIE } from "../_lib/dashboard-shell";

function applicationUrl(path: string, request: Request): URL {
  const configuredOrigin = process.env.BETTER_AUTH_URL;
  return new URL(path, configuredOrigin ?? request.url);
}

export async function GET(request: Request) {
  const shell = await getDashboardShellData();
  const eventId = new URL(request.url).searchParams.get("eventId");
  const event = shell.events.find(({ id }) => id === eventId);

  if (!event) {
    return NextResponse.redirect(applicationUrl("/dashboard", request));
  }

  const response = NextResponse.redirect(applicationUrl(dashboardEventHref(event.slug), request));
  response.cookies.set(ACTIVE_EVENT_COOKIE, event.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/dashboard",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
