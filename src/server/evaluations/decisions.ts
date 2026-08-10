import {
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  type EvaluationDecision,
  EvaluationDecisionOutcome,
  EvaluationPlanVersionStatus,
  EvaluationStatus,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { promoteAcceptedSubmissionIfPromotable } from "../sessions/repositories.ts";

export interface RecordEvaluationDecisionInput {
  readonly eventId: string;
  readonly roundId: string;
  readonly submissionId: string;
  readonly outcome: EvaluationDecisionOutcome;
  readonly expectedDecisionNumber: number;
  readonly actorId: string;
  readonly rationale?: string | null;
}

const outcomeStatuses: Readonly<Record<EvaluationDecisionOutcome, CfpSubmissionStatus>> = {
  [EvaluationDecisionOutcome.WAITLISTED]: CfpSubmissionStatus.WAITLISTED,
  [EvaluationDecisionOutcome.ACCEPTED]: CfpSubmissionStatus.ACCEPTED,
  [EvaluationDecisionOutcome.REJECTED]: CfpSubmissionStatus.REJECTED,
};

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function conflict(message: string): never {
  throw new RepositoryError("conflict", message);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") conflict("The submission decision changed while this request was being applied.");
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned evaluation decision record was not found.");
    }
  }
  throw error;
}

export class EvaluationDecisionRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async record(input: RecordEvaluationDecisionInput): Promise<EvaluationDecision> {
    const actorId = requiredText(input.actorId, "Actor");
    const rationale = optionalText(input.rationale);
    if (!Number.isInteger(input.expectedDecisionNumber) || input.expectedDecisionNumber < 0) {
      invalid("Expected decision number must be a non-negative integer.");
    }

    try {
      return await this.client.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`evaluation-decision:${input.submissionId}`}))`;

        const round = await transaction.evaluationRound.findFirst({
          where: {
            id: input.roundId,
            planVersion: {
              status: EvaluationPlanVersionStatus.ACTIVE,
              plan: { eventId: input.eventId },
            },
          },
          select: { id: true, planVersionId: true, sortOrder: true },
        });
        if (!round) throw new RepositoryError("not-found", "The active event-owned evaluation round was not found.");

        const laterRoundCount = await transaction.evaluationRound.count({
          where: { planVersionId: round.planVersionId, sortOrder: { gt: round.sortOrder } },
        });
        if (laterRoundCount > 0) invalid("Final decisions can only be recorded from the last evaluation round.");

        const submission = await transaction.cfpSubmission.findFirst({
          where: { id: input.submissionId, eventId: input.eventId },
          select: {
            id: true,
            status: true,
            evaluationAssignments: {
              where: {
                roundId: round.id,
                status: { in: [EvaluationAssignmentStatus.ASSIGNED, EvaluationAssignmentStatus.COMPLETED] },
              },
              select: { status: true, evaluation: { select: { status: true } } },
            },
            evaluationDecisions: { orderBy: { decisionNumber: "desc" }, take: 1 },
          },
        });
        if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");

        const latest = submission.evaluationDecisions[0];
        if (
          latest?.decisionNumber === input.expectedDecisionNumber + 1 &&
          latest.outcome === input.outcome &&
          latest.planVersionId === round.planVersionId &&
          latest.roundId === round.id &&
          latest.decidedBy === actorId &&
          latest.rationale === rationale
        ) {
          if (input.outcome === EvaluationDecisionOutcome.ACCEPTED) {
            await promoteAcceptedSubmissionIfPromotable(transaction, input.eventId, submission.id);
          }
          return latest;
        }

        const currentDecisionNumber = latest?.decisionNumber ?? 0;
        if (currentDecisionNumber !== input.expectedDecisionNumber) {
          conflict("The submission decision changed after this page loaded. Review the latest decision and try again.");
        }

        if (latest) {
          if (
            latest.outcome !== EvaluationDecisionOutcome.WAITLISTED ||
            submission.status !== CfpSubmissionStatus.WAITLISTED
          ) {
            invalid("Only a waitlisted submission can receive a revised final decision.");
          }
          if (input.outcome === EvaluationDecisionOutcome.WAITLISTED) {
            invalid("A waitlisted submission must be accepted or rejected when its decision changes.");
          }
          if (latest.planVersionId !== round.planVersionId || latest.roundId !== round.id) {
            invalid("A waitlist decision can only be revised from the evaluation round that produced it.");
          }
        } else {
          if (submission.status !== CfpSubmissionStatus.UNDER_REVIEW) {
            invalid("Only a submission under review can receive its first final decision.");
          }
          if (submission.evaluationAssignments.length === 0) {
            invalid("A submission needs at least one active final-round review before a decision can be recorded.");
          }
          if (
            submission.evaluationAssignments.some(
              ({ evaluation, status }) =>
                status !== EvaluationAssignmentStatus.COMPLETED || evaluation?.status !== EvaluationStatus.FINAL,
            )
          ) {
            invalid("Complete every active final-round review before recording a decision.");
          }
        }

        const toStatus = outcomeStatuses[input.outcome];
        const decidedAt = new Date();
        const updated = await transaction.cfpSubmission.updateMany({
          where: { id: submission.id, eventId: input.eventId, status: submission.status },
          data: { status: toStatus, decidedAt },
        });
        if (updated.count !== 1) conflict("The submission status changed while this decision was being applied.");

        const decision = await transaction.evaluationDecision.create({
          data: {
            planVersionId: round.planVersionId,
            roundId: round.id,
            submissionId: submission.id,
            decisionNumber: currentDecisionNumber + 1,
            outcome: input.outcome,
            supersedesDecisionId: latest?.id,
            decidedBy: actorId,
            rationale,
            decidedAt,
          },
        });
        await transaction.cfpSubmissionTransition.create({
          data: {
            submissionId: submission.id,
            fromStatus: submission.status,
            toStatus,
            actor: "ADMIN",
            actorId,
            note: rationale,
            occurredAt: decidedAt,
          },
        });
        if (input.outcome === EvaluationDecisionOutcome.ACCEPTED) {
          await promoteAcceptedSubmissionIfPromotable(transaction, input.eventId, submission.id);
        }
        return decision;
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
