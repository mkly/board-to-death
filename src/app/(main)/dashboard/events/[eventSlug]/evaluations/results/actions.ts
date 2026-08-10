"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { EvaluationDecisionOutcome, EvaluationRoundStatus } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { createConfiguredMagicLinkSender } from "@/server/auth/magic-link-email";
import { CfpDecisionNotificationRepository } from "@/server/cfp/decision-notifications";
import { DEFAULT_SPEAKER_INVITATION_LIFETIME_MS, SpeakerConfirmationService } from "@/server/cfp/speaker-confirmations";
import { getDatabaseClient } from "@/server/database/client";
import { emitWebhookEvent } from "@/server/developer-api/webhooks";
import {
  EvaluationDecisionRepository,
  EvaluationPlanRepository,
  EvaluationProgressionRepository,
} from "@/server/evaluations";
import { RepositoryError } from "@/server/events/repositories";

const actionSchema = z.object({
  eventSlug: z.string().min(1),
  roundId: z.string().uuid(),
  submissionId: z.string().uuid().optional(),
});
const decisionSchema = actionSchema.extend({
  submissionId: z.string().uuid(),
  outcome: z.enum([
    EvaluationDecisionOutcome.WAITLISTED,
    EvaluationDecisionOutcome.ACCEPTED,
    EvaluationDecisionOutcome.REJECTED,
  ]),
  expectedDecisionNumber: z.number().int().nonnegative(),
});
const runtimeConfig = getRuntimeConfig().server;
const invitationLifetimeDays = Math.round(DEFAULT_SPEAKER_INVITATION_LIFETIME_MS / 86_400_000);
const confirmationExpiry = `This link expires in ${invitationLifetimeDays} days`;
const sendConfirmationLink = createConfiguredMagicLinkSender({
  resendApiKey: runtimeConfig.RESEND_API_KEY,
  resendFromEmail: runtimeConfig.RESEND_FROM_EMAIL,
  webhookToken: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_TOKEN,
  webhookUrl: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_URL,
  wording: {
    subject: "Confirm your speaking participation",
    textIntro: `Use this single-use link to confirm your speaking participation. ${confirmationExpiry}:`,
    htmlIntro: "Use this single-use link to confirm your speaking participation:",
    linkLabel: "Confirm your participation",
    htmlExpiry: `${confirmationExpiry}.`,
  },
});

function destination(
  eventSlug: string,
  roundId: string,
  result: { readonly notice?: string; readonly error?: string },
): string {
  const search = new URLSearchParams({ round: roundId });
  if (result.notice) search.set("notice", result.notice);
  if (result.error) search.set("error", result.error);
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/evaluations/results?${search.toString()}`;
}

async function requireAdminEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await isAuthorizedAdminSession(session, { slug: eventSlug }))) {
    throw new Error("Administrator access is required.");
  }
  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true },
  });
  if (!event) throw new RepositoryError("not-found", "This event is not available.");
  return { event, actorId: session.user.id };
}

function errorMessage(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  console.error(error);
  return "The evaluation workflow could not be updated. Try again.";
}

function refresh(eventSlug: string): void {
  revalidatePath(`/dashboard/events/${eventSlug}/overview`);
  revalidatePath(`/dashboard/events/${eventSlug}/submissions`);
  revalidatePath(`/dashboard/events/${eventSlug}/evaluations`);
  revalidatePath(`/dashboard/events/${eventSlug}/evaluations/assignments`);
  revalidatePath(`/dashboard/events/${eventSlug}/evaluations/results`);
  revalidatePath(`/dashboard/events/${eventSlug}/sessions`);
}

const decisionNotices: Readonly<Record<EvaluationDecisionOutcome, string>> = {
  [EvaluationDecisionOutcome.WAITLISTED]: "Submission added to the waitlist.",
  [EvaluationDecisionOutcome.ACCEPTED]: "Submission accepted.",
  [EvaluationDecisionOutcome.REJECTED]: "Submission rejected.",
};

export async function recordEvaluationDecision(
  eventSlug: string,
  roundId: string,
  submissionId: string,
  outcome: EvaluationDecisionOutcome,
  expectedDecisionNumber: number,
): Promise<never> {
  const parsed = decisionSchema.safeParse({ eventSlug, roundId, submissionId, outcome, expectedDecisionNumber });
  if (!parsed.success) redirect(destination(eventSlug, roundId, { error: "The decision request was invalid." }));
  try {
    const { event, actorId } = await requireAdminEvent(parsed.data.eventSlug);
    const client = getDatabaseClient();
    const decision = await new EvaluationDecisionRepository(client).record({
      eventId: event.id,
      roundId: parsed.data.roundId,
      submissionId: parsed.data.submissionId,
      outcome: parsed.data.outcome,
      expectedDecisionNumber: parsed.data.expectedDecisionNumber,
      actorId,
    });
    if (
      decision.outcome === EvaluationDecisionOutcome.ACCEPTED ||
      decision.outcome === EvaluationDecisionOutcome.REJECTED
    ) {
      await new CfpDecisionNotificationRepository(client).queue(event.id, decision.id);
    }
    await emitWebhookEvent(client, {
      eventId: event.id,
      type: "submission.status_changed",
      data: { submissionId: parsed.data.submissionId, status: parsed.data.outcome },
    });
    refresh(event.slug);
  } catch (error) {
    redirect(destination(eventSlug, roundId, { error: errorMessage(error) }));
  }
  redirect(destination(eventSlug, roundId, { notice: decisionNotices[outcome] }));
}

export async function inviteAcceptedSpeakers(eventSlug: string, roundId: string, submissionId: string): Promise<never> {
  const parsed = actionSchema.safeParse({ eventSlug, roundId, submissionId });
  if (!parsed.success || !parsed.data.submissionId) {
    redirect(destination(eventSlug, roundId, { error: "The speaker invitation request was invalid." }));
  }
  let invitationCount = 0;
  try {
    const { event } = await requireAdminEvent(parsed.data.eventSlug);
    const invitations = await new SpeakerConfirmationService({ database: getDatabaseClient() }).issueInvitations(
      event.id,
      parsed.data.submissionId,
    );
    await Promise.all(
      invitations.map(async (invitation) => {
        const url = new URL(`/portal/${encodeURIComponent(event.slug)}/confirm`, runtimeConfig.BETTER_AUTH_URL);
        url.searchParams.set("submissionId", invitation.submissionId);
        url.searchParams.set("speakerId", invitation.speakerId);
        url.searchParams.set("token", invitation.token);
        await sendConfirmationLink({ email: invitation.email, url: url.toString() });
      }),
    );
    invitationCount = invitations.length;
    refresh(event.slug);
  } catch (error) {
    redirect(destination(eventSlug, roundId, { error: errorMessage(error) }));
  }
  redirect(
    destination(eventSlug, roundId, {
      notice: `Invitation${invitationCount === 1 ? "" : "s"} sent to ${invitationCount} speaker${invitationCount === 1 ? "" : "s"}.`,
    }),
  );
}

export async function advanceEvaluationSubmission(
  eventSlug: string,
  roundId: string,
  submissionId: string,
): Promise<never> {
  const parsed = actionSchema.safeParse({ eventSlug, roundId, submissionId });
  if (!parsed.success || !parsed.data.submissionId) {
    redirect(destination(eventSlug, roundId, { error: "The progression request was invalid." }));
  }
  try {
    const { event, actorId } = await requireAdminEvent(parsed.data.eventSlug);
    await new EvaluationProgressionRepository(getDatabaseClient()).advance({
      eventId: event.id,
      roundId: parsed.data.roundId,
      submissionId: parsed.data.submissionId,
      actorId,
    });
    refresh(event.slug);
  } catch (error) {
    redirect(destination(eventSlug, roundId, { error: errorMessage(error) }));
  }
  redirect(destination(eventSlug, roundId, { notice: "Submission advanced to the next evaluation round." }));
}

export async function closeEvaluationRound(eventSlug: string, roundId: string): Promise<never> {
  const parsed = actionSchema.safeParse({ eventSlug, roundId });
  if (!parsed.success) redirect(destination(eventSlug, roundId, { error: "The close-round request was invalid." }));
  try {
    const { event, actorId } = await requireAdminEvent(parsed.data.eventSlug);
    await new EvaluationPlanRepository(getDatabaseClient()).transition(
      event.id,
      parsed.data.roundId,
      EvaluationRoundStatus.CLOSED,
      { actorId },
    );
    refresh(event.slug);
  } catch (error) {
    redirect(destination(eventSlug, roundId, { error: errorMessage(error) }));
  }
  redirect(destination(eventSlug, roundId, { notice: "Evaluation round closed." }));
}
