import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/server/auth/auth";
import { consumeOrganizationSignupIntent } from "@/server/auth/signup-intent";
import { getDatabaseClient } from "@/server/database/client";

import { ACTIVE_ORGANIZATION_COOKIE } from "../../../../dashboard/_lib/dashboard-shell";

function applicationUrl(path: string, request: Request): URL {
  return new URL(path, process.env.BETTER_AUTH_URL ?? request.url);
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const token = new URL(request.url).searchParams.get("intent");
  if (!session || !token) {
    return NextResponse.redirect(applicationUrl("/auth/v1/register?error=invalid-link", request));
  }

  const organization = await consumeOrganizationSignupIntent(getDatabaseClient(), {
    token,
    userId: session.user.id,
    email: session.user.email,
  });
  if (!organization) {
    return NextResponse.redirect(applicationUrl("/auth/v1/register?error=invalid-link", request));
  }

  const response = NextResponse.redirect(applicationUrl("/dashboard", request));
  response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organization.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/dashboard",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
