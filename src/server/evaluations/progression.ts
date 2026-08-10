import {
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  type EvaluationRoundAdvancement,
  EvaluationRoundStatus,
  EvaluationStatus,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface AdvanceEvaluationSubmissionInput {
  readonly eventId: string;
  readonly roundId: string;
  readonly submissionId: string;
  readonly actorId: string;
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned evaluation workflow record was not found.");
    }
  }
  throw error;
}

export class EvaluationProgressionRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async advance(input: AdvanceEvaluationSubmissionInput): Promise<EvaluationRoundAdvancement> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const existing = await transaction.evaluationRoundAdvancement.findFirst({
          where: {
            sourceRoundId: input.roundId,
            submissionId: input.submissionId,
            sourceRound: { planVersion: { plan: { eventId: input.eventId } } },
            submission: { eventId: input.eventId },
          },
        });
        if (existing) return existing;

        const round = await transaction.evaluationRound.findFirst({
          where: { id: input.roundId, planVersion: { plan: { eventId: input.eventId } } },
          select: { id: true, planVersionId: true, sortOrder: true, status: true },
        });
        if (!round) throw new RepositoryError("not-found", "The event-owned evaluation round was not found.");
        if (round.status !== EvaluationRoundStatus.OPEN) {
          invalid("Submissions can only advance from an open evaluation round.");
        }

        const targetRound = await transaction.evaluationRound.findFirst({
          where: { planVersionId: round.planVersionId, sortOrder: { gt: round.sortOrder } },
          orderBy: { sortOrder: "asc" },
          select: { id: true, status: true },
        });
        if (!targetRound) invalid("This is the final evaluation round; there is no later round to advance into.");
        if (targetRound.status !== EvaluationRoundStatus.PLANNED) {
          invalid("The next evaluation round must still be planned before submissions can advance into it.");
        }

        const submission = await transaction.cfpSubmission.findFirst({
          where: {
            id: input.submissionId,
            eventId: input.eventId,
            status: { in: [CfpSubmissionStatus.SUBMITTED, CfpSubmissionStatus.UNDER_REVIEW] },
          },
          select: {
            id: true,
            evaluationAssignments: {
              where: {
                roundId: round.id,
                status: { in: [EvaluationAssignmentStatus.ASSIGNED, EvaluationAssignmentStatus.COMPLETED] },
              },
              select: { status: true, evaluation: { select: { status: true } } },
            },
          },
        });
        if (!submission) invalid("Select an eligible submission from this event.");
        if (submission.evaluationAssignments.length === 0) {
          invalid("A submission needs at least one active reviewer assignment before it can advance.");
        }
        if (
          submission.evaluationAssignments.some(
            ({ evaluation, status }) =>
              status !== EvaluationAssignmentStatus.COMPLETED || evaluation?.status !== EvaluationStatus.FINAL,
          )
        ) {
          invalid("Complete every active reviewer assignment before advancing this submission.");
        }

        return transaction.evaluationRoundAdvancement.upsert({
          where: { sourceRoundId_submissionId: { sourceRoundId: round.id, submissionId: submission.id } },
          create: {
            sourceRoundId: round.id,
            targetRoundId: targetRound.id,
            submissionId: submission.id,
            actorId: requiredText(input.actorId, "Actor"),
          },
          update: {},
        });
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002") {
        const existing = await this.client.evaluationRoundAdvancement.findFirst({
          where: {
            sourceRoundId: input.roundId,
            submissionId: input.submissionId,
            sourceRound: { planVersion: { plan: { eventId: input.eventId } } },
            submission: { eventId: input.eventId },
          },
        });
        if (existing) return existing;
        throw new RepositoryError("conflict", "The submission already has a different progression record.");
      }
      return mapDatabaseError(error);
    }
  }
}
