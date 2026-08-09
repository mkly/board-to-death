"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { EvaluationRoundStatus, ReviewerVisibility } from "@/generated/prisma/client";
import { getAllowedAdminEmails, isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { EvaluationPlanRepository } from "@/server/evaluations";
import { EvaluationRubricRepository } from "@/server/evaluations/rubrics";
import { RepositoryError } from "@/server/events/repositories";

const keySchema = z
  .string()
  .trim()
  .min(1, "Enter a stable key.")
  .max(80, "Use 80 characters or fewer for the key.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens for the key.");
const titleSchema = z.string().trim().min(1, "Enter a title.").max(120, "Use 120 characters or fewer.");
const descriptionSchema = z.string().trim().max(500, "Use 500 characters or fewer.");
const planSchema = z.object({ key: keySchema, title: titleSchema, description: descriptionSchema });
const roundSchema = planSchema.extend({ reviewerVisibility: z.enum(ReviewerVisibility) });

const criterionSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, "Enter a criterion key.")
      .max(80, "Use 80 characters or fewer for the key.")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens for the key."),
    label: z.string().trim().min(1, "Enter a criterion label.").max(120, "Use 120 characters or fewer."),
    description: z.string().trim().max(500, "Use 500 characters or fewer."),
    minimum: z.coerce.number().finite("Enter a minimum score."),
    maximum: z.coerce.number().finite("Enter a maximum score."),
    weight: z.coerce.number().positive("Weight must be greater than zero."),
    required: z.boolean(),
  })
  .refine(({ maximum, minimum }) => maximum > minimum, {
    message: "Maximum score must be greater than minimum score.",
    path: ["maximum"],
  });

const allowedAdminEmails = getAllowedAdminEmails(getRuntimeConfig().server.AUTH_ALLOWED_EMAILS);

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function requireAdminEvent(
  eventSlug: string,
): Promise<{ readonly id: string; readonly slug: string; readonly actorId: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email, allowedAdminEmails)) {
    throw new Error("Administrator access is required.");
  }
  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true },
  });
  if (!event) throw new RepositoryError("not-found", "This event is not available.");
  return { ...event, actorId: session.user.id };
}

function destination(eventSlug: string, result: { readonly notice?: string; readonly error?: string }): string {
  const search = new URLSearchParams();
  if (result.notice) search.set("notice", result.notice);
  if (result.error) search.set("error", result.error);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/evaluations${suffix}`;
}

function refreshAndRedirect(eventSlug: string, notice: string): never {
  const path = destination(eventSlug, {});
  revalidatePath(path);
  redirect(destination(eventSlug, { notice }));
}

function errorMessage(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  console.error(error);
  return "The evaluation workspace could not be updated. Try again.";
}

export async function createPlan(eventSlug: string, formData: FormData): Promise<never> {
  const parsed = planSchema.safeParse({
    key: field(formData, "key"),
    title: field(formData, "title"),
    description: field(formData, "description"),
  });
  if (!parsed.success) {
    redirect(destination(eventSlug, { error: parsed.error.issues[0]?.message ?? "Review the plan details." }));
  }
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EvaluationPlanRepository(getDatabaseClient()).create(event.id, parsed.data);
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(eventSlug, "Evaluation plan created.");
}

export async function createRound(eventSlug: string, planVersionId: string, formData: FormData): Promise<never> {
  const parsed = roundSchema.safeParse({
    key: field(formData, "key"),
    title: field(formData, "title"),
    description: field(formData, "description"),
    reviewerVisibility: field(formData, "reviewerVisibility"),
  });
  if (!parsed.success) {
    redirect(destination(eventSlug, { error: parsed.error.issues[0]?.message ?? "Review the round details." }));
  }
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EvaluationPlanRepository(getDatabaseClient()).createRound({
      eventId: event.id,
      planVersionId,
      ...parsed.data,
    });
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(eventSlug, "Planned round added.");
}

export async function updateRound(eventSlug: string, roundId: string, formData: FormData): Promise<never> {
  const parsed = roundSchema.safeParse({
    key: field(formData, "key"),
    title: field(formData, "title"),
    description: field(formData, "description"),
    reviewerVisibility: field(formData, "reviewerVisibility"),
  });
  if (!parsed.success) {
    redirect(destination(eventSlug, { error: parsed.error.issues[0]?.message ?? "Review the round details." }));
  }
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EvaluationPlanRepository(getDatabaseClient()).updateRound(event.id, roundId, parsed.data);
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(eventSlug, "Planned round saved.");
}

export async function moveRound(
  eventSlug: string,
  planVersionId: string,
  roundId: string,
  offset: -1 | 1,
): Promise<never> {
  try {
    const event = await requireAdminEvent(eventSlug);
    const repository = new EvaluationPlanRepository(getDatabaseClient());
    const plans = await repository.list(event.id);
    const version = plans.flatMap(({ versions }) => versions).find(({ id }) => id === planVersionId);
    if (!version) throw new RepositoryError("not-found", "The event-owned evaluation plan version was not found.");
    const index = version.rounds.findIndex(({ id }) => id === roundId);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= version.rounds.length) {
      throw new RepositoryError("invalid-input", "That round cannot move any farther.");
    }
    const orderedIds = version.rounds.map(({ id }) => id);
    [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex] ?? "", orderedIds[index] ?? ""];
    await repository.reorder(event.id, planVersionId, orderedIds);
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(eventSlug, "Round order updated.");
}

export async function transitionRound(
  eventSlug: string,
  roundId: string,
  toStatus: Exclude<EvaluationRoundStatus, "PLANNED">,
): Promise<never> {
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EvaluationPlanRepository(getDatabaseClient()).transition(event.id, roundId, toStatus, {
      actorId: event.actorId,
    });
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  let notice = "Round archived.";
  if (toStatus === EvaluationRoundStatus.OPEN) notice = "Round opened and reviewer visibility snapshotted.";
  else if (toStatus === EvaluationRoundStatus.CLOSED) notice = "Round closed.";
  return refreshAndRedirect(eventSlug, notice);
}

function parsedCriterion(formData: FormData) {
  return criterionSchema.safeParse({
    key: field(formData, "key"),
    label: field(formData, "label"),
    description: field(formData, "description"),
    minimum: field(formData, "minimum"),
    maximum: field(formData, "maximum"),
    weight: field(formData, "weight"),
    required: formData.has("required"),
  });
}

export async function createCriterion(eventSlug: string, roundId: string, formData: FormData): Promise<never> {
  const parsed = parsedCriterion(formData);
  if (!parsed.success) {
    redirect(destination(eventSlug, { error: parsed.error.issues[0]?.message ?? "Review the criterion details." }));
  }
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EvaluationRubricRepository(getDatabaseClient()).add(event.id, roundId, parsed.data);
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(eventSlug, "Rubric criterion added.");
}

export async function updateCriterion(eventSlug: string, criterionId: string, formData: FormData): Promise<never> {
  const parsed = parsedCriterion(formData);
  if (!parsed.success) {
    redirect(destination(eventSlug, { error: parsed.error.issues[0]?.message ?? "Review the criterion details." }));
  }
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EvaluationRubricRepository(getDatabaseClient()).update(event.id, criterionId, parsed.data);
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(eventSlug, "Rubric criterion saved.");
}

export async function addDefaultCriteria(eventSlug: string, roundId: string): Promise<never> {
  try {
    const event = await requireAdminEvent(eventSlug);
    await new EvaluationRubricRepository(getDatabaseClient()).addDefaults(event.id, roundId);
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(eventSlug, "Default 1-to-5 rubric added.");
}

export async function moveCriterion(
  eventSlug: string,
  roundId: string,
  criterionId: string,
  offset: -1 | 1,
): Promise<never> {
  try {
    const event = await requireAdminEvent(eventSlug);
    const repository = new EvaluationRubricRepository(getDatabaseClient());
    const plans = await repository.list(event.id);
    const round = plans
      .flatMap(({ versions }) => versions)
      .flatMap(({ rounds }) => rounds)
      .find(({ id }) => id === roundId);
    if (!round) throw new RepositoryError("not-found", "The event-owned evaluation round was not found.");
    const index = round.criteria.findIndex(({ id }) => id === criterionId);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= round.criteria.length) {
      throw new RepositoryError("invalid-input", "That criterion cannot move any farther.");
    }
    const orderedIds = round.criteria.map(({ id }) => id);
    [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex] ?? "", orderedIds[index] ?? ""];
    await repository.reorder(event.id, roundId, orderedIds);
  } catch (error) {
    redirect(destination(eventSlug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(eventSlug, "Criterion order updated.");
}
