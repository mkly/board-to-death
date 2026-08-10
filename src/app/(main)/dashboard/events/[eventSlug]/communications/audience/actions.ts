"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  CfpSubmissionStatus,
  ProgramSessionParticipantRole,
  SpeakerTaskAssignmentStatus,
} from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { BulkCommunicationRepository, type RecipientAudienceSelection } from "@/server/communications";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

export interface ConfirmBulkCommunicationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly deliveryHref?: string;
}

const ACCEPTANCE_STATUSES = new Set<string>(Object.values(CfpSubmissionStatus));
const ONBOARDING_STATUSES = new Set<string>(Object.values(SpeakerTaskAssignmentStatus));
const PARTICIPANT_ROLES = new Set<string>(Object.values(ProgramSessionParticipantRole));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fieldValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function fieldValues(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function audienceFrom(formData: FormData): RecipientAudienceSelection {
  return {
    speakerIds: fieldValues(formData, "speaker"),
    sessionIds: fieldValues(formData, "session"),
    participantRoles: fieldValues(formData, "participantRole").filter((value) =>
      PARTICIPANT_ROLES.has(value),
    ) as ProgramSessionParticipantRole[],
    categoryIds: fieldValues(formData, "category"),
    acceptanceStatuses: fieldValues(formData, "acceptance").filter((value) =>
      ACCEPTANCE_STATUSES.has(value),
    ) as CfpSubmissionStatus[],
    onboardingStatuses: fieldValues(formData, "onboarding").filter((value) =>
      ONBOARDING_STATUSES.has(value),
    ) as SpeakerTaskAssignmentStatus[],
    tierIds: fieldValues(formData, "tier"),
  };
}

export async function confirmBulkCommunication(
  _previousState: ConfirmBulkCommunicationState,
  formData: FormData,
): Promise<ConfirmBulkCommunicationState> {
  const eventSlug = fieldValue(formData, "eventSlug");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!(await isAuthorizedAdminSession(session, { slug: eventSlug }))) {
    return { status: "error", message: "Your admin session expired. Sign in and try again." };
  }

  const templateId = fieldValue(formData, "templateId");
  const confirmationToken = fieldValue(formData, "confirmationToken");
  if (eventSlug === "" || templateId === "" || !UUID_PATTERN.test(confirmationToken)) {
    return { status: "error", message: "The confirmation is incomplete. Refresh the preview and try again." };
  }

  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    const confirmed = await new BulkCommunicationRepository(client).confirm({
      eventId: event.id,
      templateId,
      idempotencyKey: `bulk:${confirmationToken}`,
      audience: audienceFrom(formData),
    });
    const deliveryHref = `/dashboard/events/${encodeURIComponent(event.slug)}/communications/deliveries/${confirmed.delivery.id}`;
    revalidatePath(`/dashboard/events/${event.slug}/communications/audience`);
    revalidatePath(deliveryHref);
    return {
      status: "success",
      message: confirmed.duplicate
        ? "This confirmation was already queued. No duplicate recipients were added."
        : `${confirmed.delivery.recipients.length.toString()} recipient deliveries queued from immutable snapshots.`,
      deliveryHref,
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
