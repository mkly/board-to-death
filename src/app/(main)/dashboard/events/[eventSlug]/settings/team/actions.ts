"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { EventMembershipRole } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { provisionMagicLinkUser } from "@/server/auth/magic-link-user";
import { getDatabaseClient } from "@/server/database/client";
import { EventInvitationService, type InvitationDelivery } from "@/server/event-memberships";
import { RepositoryError } from "@/server/events/repositories";

const inviteSchema = z.object({
  email: z.email("Enter a valid email address."),
  displayName: z.string().trim().max(120, "Use 120 characters or fewer for the name.").optional(),
  role: z.enum([EventMembershipRole.REVIEWER, EventMembershipRole.ORGANIZER_ADMIN]),
});

export interface EventTeamActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function succeed(eventSlug: string, notice: string): EventTeamActionState {
  revalidatePath(`/dashboard/events/${encodeURIComponent(eventSlug)}/settings/team`);
  return { status: "success", message: notice };
}

function fail(error: unknown): EventTeamActionState {
  return { status: "error", message: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  console.error(error);
  return "The event team could not be updated. Try again.";
}

async function requireAdminEvent(eventSlug: string): Promise<{ readonly id: string; readonly slug: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await isAuthorizedAdminSession(session, { slug: eventSlug }))) {
    throw new RepositoryError("not-found", "Administrator access is required.");
  }
  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true },
  });
  if (!event) throw new RepositoryError("not-found", "The event was not found.");
  return event;
}

async function magicLinkDelivery(): Promise<InvitationDelivery> {
  const requestHeaders = new Headers(await headers());
  return async ({ email, name, callbackURL }) => {
    await provisionMagicLinkUser(getDatabaseClient(), { email, name });
    await auth.api.signInMagicLink({
      headers: requestHeaders,
      body: { email, name, callbackURL, newUserCallbackURL: callbackURL, errorCallbackURL: callbackURL },
    });
  };
}

export async function inviteEventMember(
  eventSlug: string,
  _previousState: EventTeamActionState,
  formData: FormData,
): Promise<EventTeamActionState> {
  const parsed = inviteSchema.safeParse({
    email: field(formData, "email").trim().toLowerCase(),
    displayName: field(formData, "displayName"),
    role: field(formData, "role"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Review the invitation." };
  }

  try {
    const event = await requireAdminEvent(eventSlug);
    await new EventInvitationService(getDatabaseClient()).invite(
      { eventId: event.id, ...parsed.data },
      await magicLinkDelivery(),
    );
  } catch (error) {
    return fail(error);
  }
  return succeed(eventSlug, `Invitation sent to ${parsed.data.email}.`);
}

export async function resendEventInvitation(eventSlug: string, invitationId: string): Promise<EventTeamActionState> {
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EventInvitationService(getDatabaseClient()).resend(event.id, invitationId, await magicLinkDelivery());
  } catch (error) {
    return fail(error);
  }
  return succeed(eventSlug, "Invitation sent again with a fresh link.");
}

export async function revokeEventInvitation(eventSlug: string, invitationId: string): Promise<EventTeamActionState> {
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EventInvitationService(getDatabaseClient()).revoke(event.id, invitationId);
  } catch (error) {
    return fail(error);
  }
  return succeed(eventSlug, "Pending invitation revoked.");
}

export async function setEventMembershipActive(
  eventSlug: string,
  membershipId: string,
  active: boolean,
): Promise<EventTeamActionState> {
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EventInvitationService(getDatabaseClient()).setMembershipActive(event.id, membershipId, active);
  } catch (error) {
    return fail(error);
  }
  return succeed(eventSlug, active ? "Event access restored." : "Event access set to inactive.");
}
