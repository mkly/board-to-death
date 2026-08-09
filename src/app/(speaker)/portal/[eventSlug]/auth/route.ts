import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDatabaseClient } from "@/server/database/client";
import { SpeakerAuthService } from "@/server/speaker-auth";

import { portalHref, SPEAKER_SESSION_COOKIE } from "../_lib/portal-session";

interface SpeakerAuthRouteContext {
  readonly params: Promise<{ readonly eventSlug: string }>;
}

function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

export async function GET(request: NextRequest, context: SpeakerAuthRouteContext) {
  const { eventSlug } = await context.params;
  const speakerId = request.nextUrl.searchParams.get("speakerId") ?? "";
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const database = getDatabaseClient();
  const event = await database.event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });

  if (!event || speakerId === "" || token === "") {
    return NextResponse.redirect(new URL(portalHref(eventSlug, "/sign-in?invalid=1"), requestOrigin(request)));
  }

  try {
    const session = await new SpeakerAuthService({ database }).consumeMagicLink({
      eventId: event.id,
      speakerId,
      token,
    });
    const response = NextResponse.redirect(new URL(portalHref(event.slug), requestOrigin(request)));
    response.cookies.set(SPEAKER_SESSION_COOKIE, session.sessionToken, {
      expires: session.expiresAt,
      httpOnly: true,
      path: "/portal",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL(portalHref(event.slug, "/sign-in?invalid=1"), requestOrigin(request)));
  }
}
