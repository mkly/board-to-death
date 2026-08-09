import "server-only";

import { cache } from "react";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { SpeakerAuthService } from "@/server/speaker-auth";

export const SPEAKER_SESSION_COOKIE = "board-to-death.speaker-session";

export function portalHref(eventSlug: string, suffix = ""): string {
  return `/portal/${encodeURIComponent(eventSlug)}${suffix}`;
}

export const getPortalViewer = cache(async (eventSlug: string) => {
  const token = (await cookies()).get(SPEAKER_SESSION_COOKIE)?.value;
  if (!token) redirect(portalHref(eventSlug, "/sign-in"));

  const database = getDatabaseClient();
  const identity = await new SpeakerAuthService({ database }).getSession(token).catch(() => null);
  if (!identity) redirect(portalHref(eventSlug, "/sign-in?expired=1"));

  const speaker = await database.speaker.findFirst({
    where: { eventId: identity.eventId, id: identity.speakerId, event: { slug: eventSlug } },
    select: { id: true },
  });
  if (!speaker) notFound();

  return { eventId: identity.eventId, speakerId: identity.speakerId } as const;
});
