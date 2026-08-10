"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { EventMembershipRole } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { EventInvitationService, type InvitationDelivery } from "@/server/event-memberships";
import { RepositoryError } from "@/server/events/repositories";

const inviteSchema = z.object({
  email: z.email("Enter a valid email address."),
  displayName: z.string().trim().max(120, "Use 120 characters or fewer for the name.").optional(),
  role: z.enum([EventMembershipRole.REVIEWER, EventMembershipRole.ORGANIZER_ADMIN]),
});

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function destination(eventSlug: string, result: { readonly notice?: string; readonly error?: string }): string {
  const query = new URLSearchParams();
  if (result.notice) query.set("notice", result.notice);
  if (result.error) query.set("error", result.error);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/settings/team${suffix}`;
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
    await auth.api.signInMagicLink({
      headers: requestHeaders,
      body: { email, name, callbackURL, newUserCallbackURL: callbackURL, errorCallbackURL: callbackURL },
    });
  };
}

export async function inviteEventMember(eventSlug: string, formData: FormData): Promise<never> {
  const parsed = inviteSchema.safeParse({
    email: field(formData, "email").trim().toLowerCase(),
    displayName: field(formData, "displayName"),
    role: field(formData, "role"),
  });
  if (!parsed.success) {
    redirect(destination(eventSlug, { error: parsed.error.issues[0]?.message ?? "Review the invitation." }));
  }

  let result: { readonly notice?: string; readonly error?: string };
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EventInvitationService(getDatabaseClient()).invite(
      { eventId: event.id, ...parsed.data },
      await magicLinkDelivery(),
    );
    result = { notice: `Invitation sent to ${parsed.data.email}.` };
  } catch (error) {
    result = { error: errorMessage(error) };
  }
  redirect(destination(eventSlug, result));
}

export async function resendEventInvitation(eventSlug: string, invitationId: string): Promise<never> {
  let result: { readonly notice?: string; readonly error?: string };
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EventInvitationService(getDatabaseClient()).resend(event.id, invitationId, await magicLinkDelivery());
    result = { notice: "Invitation sent again with a fresh link." };
  } catch (error) {
    result = { error: errorMessage(error) };
  }
  redirect(destination(eventSlug, result));
}

export async function revokeEventInvitation(eventSlug: string, invitationId: string): Promise<never> {
  let result: { readonly notice?: string; readonly error?: string };
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EventInvitationService(getDatabaseClient()).revoke(event.id, invitationId);
    result = { notice: "Pending invitation revoked." };
  } catch (error) {
    result = { error: errorMessage(error) };
  }
  redirect(destination(eventSlug, result));
}

export async function setEventMembershipActive(
  eventSlug: string,
  membershipId: string,
  active: boolean,
): Promise<never> {
  let result: { readonly notice?: string; readonly error?: string };
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EventInvitationService(getDatabaseClient()).setMembershipActive(event.id, membershipId, active);
    result = { notice: active ? "Event access restored." : "Event access set to inactive." };
  } catch (error) {
    result = { error: errorMessage(error) };
  }
  redirect(destination(eventSlug, result));
}
