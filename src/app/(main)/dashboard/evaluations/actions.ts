"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { z } from "zod";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { EvaluationRoundStatus, ReviewerVisibility } from "@/generated/prisma/client";
import { getAllowedAdminEmails, isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database";
import { EvaluationPlanRepository, EvaluationRepositoryError } from "@/server/evaluations";

const nameSchema = z.string().trim().min(1, "Enter a name.").max(120, "Use 120 characters or fewer.");
const roundSchema = z.object({
  name: nameSchema,
  reviewerVisibility: z.enum(ReviewerVisibility),
});
const allowedAdminEmails = getAllowedAdminEmails(getRuntimeConfig().server.AUTH_ALLOWED_EMAILS);

async function requireAdmin(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email, allowedAdminEmails)) {
    throw new Error("Administrator access is required.");
  }
}

function repository(): EvaluationPlanRepository {
  return new EvaluationPlanRepository(getDatabaseClient());
}

function messageFor(error: unknown): string {
  if (error instanceof EvaluationRepositoryError) {
    return error.message;
  }
  console.error(error);
  return "The evaluation plan could not be updated. Try again.";
}

function destination(eventId: string, result: { readonly notice?: string; readonly error?: string }): string {
  const search = new URLSearchParams({ event: eventId });
  if (result.notice) search.set("notice", result.notice);
  if (result.error) search.set("error", result.error);
  return `/dashboard/evaluations?${search.toString()}`;
}

function refreshAndRedirect(eventId: string, notice: string): never {
  revalidatePath("/dashboard/evaluations");
  redirect(destination(eventId, { notice }));
}

export async function createPlan(eventId: string, formData: FormData): Promise<never> {
  await requireAdmin();
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) redirect(destination(eventId, { error: parsed.error.issues[0]?.message ?? "Enter a name." }));
  try {
    await repository().create(eventId, parsed.data);
  } catch (error) {
    redirect(destination(eventId, { error: messageFor(error) }));
  }
  return refreshAndRedirect(eventId, "Evaluation plan created.");
}

export async function createRound(eventId: string, planId: string, formData: FormData): Promise<never> {
  await requireAdmin();
  const parsed = roundSchema.safeParse({
    name: formData.get("name"),
    reviewerVisibility: formData.get("reviewerVisibility"),
  });
  if (!parsed.success) {
    redirect(destination(eventId, { error: parsed.error.issues[0]?.message ?? "Review the round details." }));
  }
  try {
    await repository().createRound({ eventId, planId, ...parsed.data });
  } catch (error) {
    redirect(destination(eventId, { error: messageFor(error) }));
  }
  return refreshAndRedirect(eventId, "Draft round added.");
}

export async function updateRound(eventId: string, roundId: string, formData: FormData): Promise<never> {
  await requireAdmin();
  const parsed = roundSchema.safeParse({
    name: formData.get("name"),
    reviewerVisibility: formData.get("reviewerVisibility"),
  });
  if (!parsed.success) {
    redirect(destination(eventId, { error: parsed.error.issues[0]?.message ?? "Review the round details." }));
  }
  try {
    await repository().updateRound(eventId, roundId, parsed.data);
  } catch (error) {
    redirect(destination(eventId, { error: messageFor(error) }));
  }
  return refreshAndRedirect(eventId, "Draft round saved.");
}

export async function moveRound(
  eventId: string,
  planId: string,
  roundId: string,
  offset: -1 | 1,
): Promise<never> {
  await requireAdmin();
  try {
    const evaluations = repository();
    const plan = await evaluations.get(eventId);
    if (!plan || plan.id !== planId) {
      throw new EvaluationRepositoryError("not-found", "The event-owned evaluation plan was not found.");
    }
    const index = plan.rounds.findIndex(({ id }) => id === roundId);
    const destinationIndex = index + offset;
    if (index < 0 || destinationIndex < 0 || destinationIndex >= plan.rounds.length) {
      throw new EvaluationRepositoryError("invalid-input", "That round cannot move any farther.");
    }
    const orderedIds = plan.rounds.map(({ id }) => id);
    [orderedIds[index], orderedIds[destinationIndex]] = [orderedIds[destinationIndex], orderedIds[index]];
    await evaluations.reorder(eventId, planId, orderedIds);
  } catch (error) {
    redirect(destination(eventId, { error: messageFor(error) }));
  }
  return refreshAndRedirect(eventId, "Round order updated.");
}

export async function transitionRound(
  eventId: string,
  roundId: string,
  toStatus: Exclude<EvaluationRoundStatus, "DRAFT">,
): Promise<never> {
  await requireAdmin();
  try {
    await repository().transition(eventId, roundId, toStatus);
  } catch (error) {
    redirect(destination(eventId, { error: messageFor(error) }));
  }
  const notice =
    toStatus === EvaluationRoundStatus.ACTIVE
      ? "Round activated and reviewer visibility snapshotted."
      : toStatus === EvaluationRoundStatus.CLOSED
        ? "Round closed."
        : "Round archived.";
  return refreshAndRedirect(eventId, notice);
}
