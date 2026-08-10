import { NextResponse } from "next/server";

import { getDashboardShellData } from "../_lib/dashboard-data";
import { ACTIVE_EVENT_COOKIE, ACTIVE_ORGANIZATION_COOKIE } from "../_lib/dashboard-shell";

function applicationUrl(path: string, request: Request): URL {
  return new URL(path, process.env.BETTER_AUTH_URL ?? request.url);
}

export async function GET(request: Request) {
  const shell = await getDashboardShellData();
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || !shell.organizations.some(({ id }) => id === organizationId)) {
    return NextResponse.redirect(applicationUrl("/dashboard", request));
  }

  const response = NextResponse.redirect(applicationUrl("/dashboard", request));
  response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/dashboard",
    maxAge: 60 * 60 * 24 * 365,
  });
  response.cookies.set(ACTIVE_EVENT_COOKIE, "", { path: "/dashboard", maxAge: 0 });
  return response;
}
