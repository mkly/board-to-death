"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { EvaluationDecisionOutcome, EvaluationRoundStatus } from "@/generated/prisma/client";
import { getAllowedAdminEmails, isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
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
const allowedAdminEmails = getAllowedAdminEmails(getRuntimeConfig().server.AUTH_ALLOWED_EMAILS);

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
  if (!session || !isAllowedAdminEmail(session.user.email, allowedAdminEmails)) {
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
    await new EvaluationDecisionRepository(getDatabaseClient()).record({
      eventId: event.id,
      roundId: parsed.data.roundId,
      submissionId: parsed.data.submissionId,
      outcome: parsed.data.outcome,
      expectedDecisionNumber: parsed.data.expectedDecisionNumber,
      actorId,
    });
    refresh(event.slug);
  } catch (error) {
    redirect(destination(eventSlug, roundId, { error: errorMessage(error) }));
  }
  redirect(destination(eventSlug, roundId, { notice: decisionNotices[outcome] }));
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
