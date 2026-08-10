"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { EvaluationAssignmentRepository } from "@/server/evaluations/assignments";
import { RepositoryError } from "@/server/events/repositories";

export interface ManageAssignmentsState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

const inputSchema = z.object({
  operation: z.enum(["assign", "assign-committee", "reassign", "withdraw"]),
  eventSlug: z.string().min(1),
  roundId: z.string().uuid(),
  reviewerId: z.string().uuid().optional(),
  committeeId: z.string().uuid().optional(),
  fromReviewerId: z.string().uuid().optional(),
  submissionIds: z.array(z.string().uuid()).min(1, "Select at least one submission."),
});

function optionalField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function manageEvaluationAssignments(
  _previousState: ManageAssignmentsState,
  formData: FormData,
): Promise<ManageAssignmentsState> {
  const result = inputSchema.safeParse({
    operation: formData.get("operation"),
    eventSlug: formData.get("eventSlug"),
    roundId: formData.get("roundId"),
    reviewerId: optionalField(formData, "reviewerId"),
    committeeId: optionalField(formData, "committeeId"),
    fromReviewerId: optionalField(formData, "fromReviewerId"),
    submissionIds: formData.getAll("submissionIds"),
  });
  if (!result.success) {
    return { status: "error", message: result.error.issues[0]?.message ?? "Check the assignment fields." };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await isAuthorizedAdminSession(session, { slug: result.data.eventSlug }))) {
    return { status: "error", message: "Your administrator session expired. Sign in and try again." };
  }

  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: result.data.eventSlug },
    select: { id: true, slug: true },
  });
  if (!event) return { status: "error", message: "This event is not available." };

  const repository = new EvaluationAssignmentRepository(client);
  try {
    let count: number;
    if (result.data.operation === "assign") {
      if (!result.data.reviewerId) return { status: "error", message: "Select a reviewer to assign." };
      count = await repository.assign({
        eventId: event.id,
        roundId: result.data.roundId,
        reviewerId: result.data.reviewerId,
        submissionIds: result.data.submissionIds,
      });
    } else if (result.data.operation === "assign-committee") {
      if (!result.data.committeeId) return { status: "error", message: "Select a reviewer committee to assign." };
      count = await repository.assignCommittee({
        eventId: event.id,
        roundId: result.data.roundId,
        committeeId: result.data.committeeId,
        submissionIds: result.data.submissionIds,
      });
    } else if (result.data.operation === "reassign") {
      if (!result.data.fromReviewerId || !result.data.reviewerId) {
        return { status: "error", message: "Select both the current and replacement reviewers." };
      }
      count = await repository.reassign({
        eventId: event.id,
        roundId: result.data.roundId,
        fromReviewerId: result.data.fromReviewerId,
        reviewerId: result.data.reviewerId,
        submissionIds: result.data.submissionIds,
      });
    } else {
      if (!result.data.fromReviewerId) return { status: "error", message: "Select a reviewer to withdraw." };
      count = await repository.withdraw({
        eventId: event.id,
        roundId: result.data.roundId,
        reviewerId: result.data.fromReviewerId,
        submissionIds: result.data.submissionIds,
      });
    }

    revalidatePath(`/dashboard/events/${event.slug}/evaluations/assignments`);
    const label = count === 1 ? "reviewer assignment" : "reviewer assignments";
    return { status: "success", message: `${count} ${label} updated.` };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

const reopenSchema = z.object({
  eventSlug: z.string().min(1),
  assignmentId: z.string().uuid(),
  expectedEvaluationVersion: z.coerce.number().int().positive(),
});

export async function reopenEvaluationAssignment(
  _previousState: ManageAssignmentsState,
  formData: FormData,
): Promise<ManageAssignmentsState> {
  const result = reopenSchema.safeParse({
    eventSlug: formData.get("eventSlug"),
    assignmentId: formData.get("assignmentId"),
    expectedEvaluationVersion: formData.get("expectedEvaluationVersion"),
  });
  if (!result.success) {
    return { status: "error", message: result.error.issues[0]?.message ?? "Check the assignment fields." };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await isAuthorizedAdminSession(session, { slug: result.data.eventSlug }))) {
    return { status: "error", message: "Your administrator session expired. Sign in and try again." };
  }

  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: result.data.eventSlug },
    select: { id: true, slug: true },
  });
  if (!event) return { status: "error", message: "This event is not available." };

  const repository = new EvaluationAssignmentRepository(client);
  try {
    await repository.reopenEvaluation(event.id, result.data.assignmentId, {
      actorId: session.user.id,
      expectedEvaluationVersion: result.data.expectedEvaluationVersion,
    });
    revalidatePath(`/dashboard/events/${event.slug}/evaluations/assignments`);
    revalidatePath(`/dashboard/events/${event.slug}/evaluations/results`);
    return { status: "success", message: "Evaluation returned to the reviewer for correction." };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
