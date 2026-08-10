"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { EventMembershipRole } from "@/generated/prisma/client";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { EventInvitationService } from "@/server/event-memberships";
import { RepositoryError } from "@/server/events/repositories";

export async function acceptEventInvitation(token: string): Promise<never> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/v1/login");

  let accepted: { readonly eventSlug: string; readonly role: EventMembershipRole };
  try {
    accepted = await new EventInvitationService(getDatabaseClient()).accept(token, session.user);
  } catch (error) {
    const message =
      error instanceof RepositoryError
        ? error.message
        : "The invitation could not be accepted. Ask the organizer for a new link.";
    redirect(`/invitations/${encodeURIComponent(token)}?error=${encodeURIComponent(message)}`);
  }

  if (accepted.role === EventMembershipRole.REVIEWER) redirect("/reviews?invited=1");
  redirect(`/dashboard/events/${encodeURIComponent(accepted.eventSlug)}/settings/team?notice=Invitation+accepted.`);
}
