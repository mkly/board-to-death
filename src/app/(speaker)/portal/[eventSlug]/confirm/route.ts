import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SpeakerConfirmationService } from "@/server/cfp/speaker-confirmations";
import { getDatabaseClient } from "@/server/database/client";

import { portalHref, SPEAKER_SESSION_COOKIE } from "../_lib/portal-session";

interface SpeakerConfirmationRouteContext {
  readonly params: Promise<{ readonly eventSlug: string }>;
}

function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

function failureRedirect(eventSlug: string, request: NextRequest) {
  return NextResponse.redirect(new URL(portalHref(eventSlug, "/sign-in?invalid=1"), requestOrigin(request)));
}

export async function GET(request: NextRequest, context: SpeakerConfirmationRouteContext) {
  const { eventSlug } = await context.params;
  const submissionId = request.nextUrl.searchParams.get("submissionId") ?? "";
  const speakerId = request.nextUrl.searchParams.get("speakerId") ?? "";
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const database = getDatabaseClient();
  const event = await database.event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
  if (!event || !submissionId || !speakerId || !token) return failureRedirect(eventSlug, request);

  try {
    const confirmation = await new SpeakerConfirmationService({ database }).confirm({
      eventId: event.id,
      submissionId,
      speakerId,
      token,
    });
    const response = NextResponse.redirect(
      new URL(portalHref(event.slug, `/submissions/${submissionId}?confirmed=1`), requestOrigin(request)),
    );
    response.cookies.set(SPEAKER_SESSION_COOKIE, confirmation.sessionToken, {
      expires: confirmation.sessionExpiresAt,
      httpOnly: true,
      path: "/portal",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
    return response;
  } catch {
    return failureRedirect(event.slug, request);
  }
}
