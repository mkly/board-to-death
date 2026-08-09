import "server-only";

import { cache } from "react";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { type PortalContentKey, resolveParticipantPortal } from "@/server/participant-portals";
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

export const getPortalConfiguration = cache(async (eventSlug: string) => {
  const viewer = await getPortalViewer(eventSlug);
  return resolveParticipantPortal(getDatabaseClient(), viewer);
});

export async function requirePortalContent(eventSlug: string, content: PortalContentKey) {
  const [viewer, portal] = await Promise.all([getPortalViewer(eventSlug), getPortalConfiguration(eventSlug)]);
  if (!portal.contentVisibility[content]) notFound();
  return { viewer, portal } as const;
}
