"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { SpeakerWorkflowStatus } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { createConfiguredSpeakerMagicLinkDelivery } from "@/server/speaker-auth/configured-speaker-magic-link";
import { SpeakerRepository } from "@/server/speakers";

export interface ResendSpeakerLinkActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
}

const requestSchema = z.object({
  eventSlug: z.string().trim().min(1),
  speakerId: z.uuid(),
});

export interface UpdateSpeakerWorkflowStatusActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
}

const workflowStatusSchema = z.object({
  eventSlug: z.string().trim().min(1),
  speakerId: z.uuid(),
  workflowStatus: z.enum(SpeakerWorkflowStatus),
});

export async function updateSpeakerWorkflowStatus(
  eventSlug: string,
  speakerId: string,
  _previousState: UpdateSpeakerWorkflowStatusActionState,
  formData: FormData,
): Promise<UpdateSpeakerWorkflowStatusActionState> {
  const parsed = workflowStatusSchema.safeParse({
    eventSlug,
    speakerId,
    workflowStatus: formData.get("workflowStatus"),
  });
  if (!parsed.success) return { status: "error", message: "Choose a valid workflow status." };

  const session = await auth.api.getSession({ headers: await headers() });
  if (!(await isAuthorizedAdminSession(session, { slug: parsed.data.eventSlug }))) {
    return { status: "error", message: "Administrator access is required." };
  }

  const client = getDatabaseClient();
  const event = await client.event.findFirst({
    where: { slug: parsed.data.eventSlug, archivedAt: null },
    select: { id: true, slug: true },
  });
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    await new SpeakerRepository(client).updateWorkflowStatus(
      event.id,
      parsed.data.speakerId,
      parsed.data.workflowStatus,
    );
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/speakers`);
    return { status: "success", message: "Workflow status saved." };
  } catch {
    return { status: "error", message: "This speaker is not available for the event." };
  }
}

export async function resendSpeakerPortalLink(
  eventSlug: string,
  speakerId: string,
  _previousState: ResendSpeakerLinkActionState,
): Promise<ResendSpeakerLinkActionState> {
  const parsed = requestSchema.safeParse({ eventSlug, speakerId });
  if (!parsed.success) return { status: "error", message: "The speaker link request is invalid." };

  const session = await auth.api.getSession({ headers: await headers() });
  if (!(await isAuthorizedAdminSession(session, { slug: parsed.data.eventSlug }))) {
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
