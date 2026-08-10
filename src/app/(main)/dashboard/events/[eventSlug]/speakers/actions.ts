"use server";

import { headers } from "next/headers";

import { z } from "zod";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { createConfiguredSpeakerMagicLinkDelivery } from "@/server/speaker-auth/configured-speaker-magic-link";

export interface ResendSpeakerLinkActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
}

const requestSchema = z.object({
  eventSlug: z.string().trim().min(1),
  speakerId: z.uuid(),
});

export async function resendSpeakerPortalLink(
  eventSlug: string,
  speakerId: string,
  _previousState: ResendSpeakerLinkActionState,
): Promise<ResendSpeakerLinkActionState> {
  const parsed = requestSchema.safeParse({ eventSlug, speakerId });
  if (!parsed.success) return { status: "error", message: "The speaker link request is invalid." };

  const session = await auth.api.getSession({ headers: await headers() });
  if (!isAuthorizedAdminSession(session)) {
    return { status: "error", message: "Administrator access is required." };
  }

  const event = await getDatabaseClient().event.findFirst({
    where: { slug: parsed.data.eventSlug, archivedAt: null },
    select: { id: true },
  });
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    await createConfiguredSpeakerMagicLinkDelivery().resendForSpeaker({
      eventId: event.id,
      speakerId: parsed.data.speakerId,
    });
    return { status: "success", message: "A fresh speaker portal sign-in link was sent." };
  } catch (error) {
    console.error("[speaker-auth] Could not resend a speaker portal link.", error);
    return { status: "error", message: "The sign-in link could not be sent. Try again." };
  }
}
