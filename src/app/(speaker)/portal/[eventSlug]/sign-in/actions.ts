"use server";

import { z } from "zod";

import { createConfiguredSpeakerMagicLinkDelivery } from "@/server/speaker-auth/configured-speaker-magic-link";

export interface SpeakerSignInActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
}

const requestSchema = z.object({
  email: z.email("Enter a valid email address."),
  eventSlug: z.string().trim().min(1),
});

const SUCCESS_MESSAGE = "If that address belongs to a speaker for this event, a sign-in link is on its way.";

export async function requestSpeakerSignInLink(
  eventSlug: string,
  _previousState: SpeakerSignInActionState,
  formData: FormData,
): Promise<SpeakerSignInActionState> {
  const parsed = requestSchema.safeParse({ eventSlug, email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
  }

  try {
    await createConfiguredSpeakerMagicLinkDelivery().requestForEmail(parsed.data);
  } catch (error) {
    // The public response deliberately does not reveal whether an event-scoped speaker exists.
    console.error("[speaker-auth] Could not deliver a requested speaker portal link.", error);
  }

  return { status: "success", message: SUCCESS_MESSAGE };
}
