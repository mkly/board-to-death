"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { CfpSubmissionStatus } from "@/generated/prisma/client";
import { parseSubmissionView } from "@/lib/cfp/submission-table";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CfpSubmissionRepository } from "@/server/cfp/submissions";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { ProgramSessionRepository } from "@/server/sessions/repositories";

export interface SubmissionViewActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

export interface SubmissionDecisionActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

export interface SubmissionPromotionActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly sessionId?: string;
}

const decisions = [CfpSubmissionStatus.WAITLISTED, CfpSubmissionStatus.ACCEPTED, CfpSubmissionStatus.REJECTED] as const;

type SubmissionDecision = (typeof decisions)[number];

function value(formData: FormData, name: string): string {
  const field = formData.get(name);
  return typeof field === "string" ? field.trim() : "";
}

function decisionValue(value: string): SubmissionDecision | null {
  return decisions.find((decision) => decision === value) ?? null;
}

function decisionLabel(decision: SubmissionDecision): string {
  if (decision === CfpSubmissionStatus.WAITLISTED) return "waitlisted";
  return decision.toLowerCase();
}

async function authorizedContext(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;
  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true },
  });
  return event ? { event, userId: session.user.id } : null;
}

export async function saveSubmissionView(
  _previousState: SubmissionViewActionState,
  formData: FormData,
): Promise<SubmissionViewActionState> {
  const eventSlug = String(formData.get("eventSlug") ?? "");
  const context = await authorizedContext(eventSlug);
  if (!context) return { status: "error", message: "This event is not available." };

  let view: ReturnType<typeof parseSubmissionView>;
  try {
    view = parseSubmissionView(JSON.parse(String(formData.get("view") ?? "null")));
  } catch {
    return { status: "error", message: "The table view could not be saved." };
  }

  await getDatabaseClient().cfpSubmissionView.upsert({
    where: { eventId_userId: { eventId: context.event.id, userId: context.userId } },
    create: { eventId: context.event.id, userId: context.userId, ...view },
    update: view,
  });
  revalidatePath(`/dashboard/events/${context.event.slug}/submissions`);
  return { status: "success", message: "Your table view was saved for this event." };
}

export async function resetSubmissionView(eventSlug: string): Promise<SubmissionViewActionState> {
  const context = await authorizedContext(eventSlug);
  if (!context) return { status: "error", message: "This event is not available." };
  await getDatabaseClient().cfpSubmissionView.deleteMany({
    where: { eventId: context.event.id, userId: context.userId },
  });
  revalidatePath(`/dashboard/events/${context.event.slug}/submissions`);
  return { status: "success", message: "Saved table view reset." };
}

export async function recordSubmissionDecision(
  _previousState: SubmissionDecisionActionState,
  formData: FormData,
): Promise<SubmissionDecisionActionState> {
  const eventSlug = value(formData, "eventSlug");
  const context = await authorizedContext(eventSlug);
  if (!context) return { status: "error", message: "Your admin session expired. Sign in and try again." };

  const submissionId = value(formData, "submissionId");
  const decision = decisionValue(value(formData, "decision"));
  if (!submissionId || !decision) return { status: "error", message: "Choose a valid submission decision." };

  const repository = new CfpSubmissionRepository(getDatabaseClient());
  try {
    const submission = await repository.get(context.event.id, submissionId);
    if (!submission) return { status: "error", message: "The event-owned submission was not found." };
    if (submission.status === CfpSubmissionStatus.SUBMITTED) {
      await repository.transition(context.event.id, submissionId, CfpSubmissionStatus.UNDER_REVIEW, {
        actorId: context.userId,
      });
    }
    await repository.transition(context.event.id, submissionId, decision, { actorId: context.userId });
    const submissionsPath = `/dashboard/events/${context.event.slug}/submissions`;
    revalidatePath(submissionsPath);
    revalidatePath(`${submissionsPath}/${submissionId}`);
    return { status: "success", message: `Proposal marked as ${decisionLabel(decision)}.` };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function promoteSubmissionToSession(
  _previousState: SubmissionPromotionActionState,
  formData: FormData,
): Promise<SubmissionPromotionActionState> {
  const eventSlug = value(formData, "eventSlug");
  const context = await authorizedContext(eventSlug);
  if (!context) return { status: "error", message: "Your admin session expired. Sign in and try again." };

  const submissionId = value(formData, "submissionId");
  if (!submissionId) return { status: "error", message: "Choose a valid submission to promote." };

  try {
    const promoted = await new ProgramSessionRepository(getDatabaseClient()).promote({
      eventId: context.event.id,
      sourceSubmissionId: submissionId,
    });
    const submissionsPath = `/dashboard/events/${context.event.slug}/submissions`;
    revalidatePath(submissionsPath);
    revalidatePath(`${submissionsPath}/${submissionId}`);
    revalidatePath(`/dashboard/events/${context.event.slug}/sessions`);
    return {
      status: "success",
      message: "Proposal promoted to a program session.",
      sessionId: promoted.id,
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
