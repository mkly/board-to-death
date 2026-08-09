"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { EvaluationRecommendation } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/server/database/client";
import { getReviewerSession } from "@/server/evaluations/reviewer-session";
import { ReviewerWorkspaceRepository } from "@/server/evaluations/reviewer-workspace";
import { RepositoryError } from "@/server/events/repositories";

export interface EvaluationFormState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

const criterionSchema = z.object({
  criterionId: z.string().uuid(),
  score: z.number().nullable(),
  note: z.string().nullable(),
});

const draftSchema = z.object({
  assignmentId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().min(0),
  overallNote: z.string().nullable(),
  recommendation: z.nativeEnum(EvaluationRecommendation).nullable(),
  criteria: z.array(criterionSchema),
});

const submissionSchema = draftSchema.extend({
  recommendation: z.nativeEnum(EvaluationRecommendation),
});

function parseCriteria(formData: FormData): z.infer<typeof criterionSchema>[] {
  const criterionIds = formData.getAll("criterionId");
  return criterionIds.map((rawCriterionId) => {
    const criterionId = String(rawCriterionId);
    const rawScore = formData.get(`score:${criterionId}`);
    const rawNote = formData.get(`note:${criterionId}`);
    const scoreText = typeof rawScore === "string" ? rawScore.trim() : "";
    return {
      criterionId,
      score: scoreText === "" ? null : Number(scoreText),
      note: typeof rawNote === "string" && rawNote.trim() !== "" ? rawNote : null,
    };
  });
}

function parseCommon(formData: FormData) {
  const rawOverallNote = formData.get("overallNote");
  const rawRecommendation = formData.get("recommendation");
  return {
    assignmentId: formData.get("assignmentId"),
    expectedVersion: formData.get("expectedVersion"),
    overallNote: typeof rawOverallNote === "string" && rawOverallNote.trim() !== "" ? rawOverallNote : null,
    recommendation: typeof rawRecommendation === "string" && rawRecommendation !== "" ? rawRecommendation : null,
    criteria: parseCriteria(formData),
  };
}

export async function saveEvaluationDraft(
  _previousState: EvaluationFormState,
  formData: FormData,
): Promise<EvaluationFormState> {
  const { user } = await getReviewerSession();

  const result = draftSchema.safeParse(parseCommon(formData));
  if (!result.success) {
    return { status: "error", message: result.error.issues[0]?.message ?? "Check the evaluation fields." };
  }

  const repository = new ReviewerWorkspaceRepository(getDatabaseClient());
  try {
    await repository.saveDraft(user.id, result.data.assignmentId, {
      expectedVersion: result.data.expectedVersion,
      overallNote: result.data.overallNote,
      recommendation: result.data.recommendation,
      criteria: result.data.criteria,
    });
    revalidatePath(`/reviews/${result.data.assignmentId}`);
    return { status: "success", message: "Draft saved." };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function submitEvaluation(
  _previousState: EvaluationFormState,
  formData: FormData,
): Promise<EvaluationFormState> {
  const { user } = await getReviewerSession();

  const result = submissionSchema.safeParse(parseCommon(formData));
  if (!result.success) {
    return { status: "error", message: result.error.issues[0]?.message ?? "Check the evaluation fields." };
  }

  const repository = new ReviewerWorkspaceRepository(getDatabaseClient());
  try {
    await repository.submitFinal(user.id, result.data.assignmentId, {
      expectedVersion: result.data.expectedVersion,
      overallNote: result.data.overallNote,
      recommendation: result.data.recommendation,
      criteria: result.data.criteria,
    });
    revalidatePath(`/reviews/${result.data.assignmentId}`);
    return { status: "success", message: "Evaluation submitted." };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
