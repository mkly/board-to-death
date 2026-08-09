import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDatabaseClient } from "@/server/database/client";
import { SpeakerAuthService } from "@/server/speaker-auth";

import { portalHref, SPEAKER_SESSION_COOKIE } from "../_lib/portal-session";

interface SpeakerLogoutRouteContext {
  readonly params: Promise<{ readonly eventSlug: string }>;
}

function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

export async function POST(request: NextRequest, context: SpeakerLogoutRouteContext) {
  const { eventSlug } = await context.params;
  const token = request.cookies.get(SPEAKER_SESSION_COOKIE)?.value;
  if (token) {
    const auth = new SpeakerAuthService({ database: getDatabaseClient() });
    const identity = await auth.getSession(token).catch(() => null);
    if (identity) await auth.logout(token);
  }

  const response = NextResponse.redirect(new URL(portalHref(eventSlug, "/sign-in"), requestOrigin(request)), 303);
  response.cookies.set(SPEAKER_SESSION_COOKIE, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/portal",
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}
