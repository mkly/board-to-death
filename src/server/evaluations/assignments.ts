import {
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

const eligibleSubmissionStatuses = [CfpSubmissionStatus.SUBMITTED, CfpSubmissionStatus.UNDER_REVIEW] as const;

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export interface EvaluationRoundOption {
  readonly id: string;
  readonly title: string;
  readonly planTitle: string;
}

export interface EvaluationReviewerOption {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

export interface EvaluationAssignmentSubmission {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly formTitle: string;
  readonly primarySpeaker: string | null;
  readonly categories: readonly string[];
  readonly assignments: readonly {
    readonly id: string;
    readonly reviewerId: string;
    readonly reviewerName: string;
    readonly status: string;
  }[];
}

export interface EvaluationAssignmentWorkspace {
  readonly rounds: readonly EvaluationRoundOption[];
  readonly selectedRoundId: string | null;
  readonly reviewers: readonly EvaluationReviewerOption[];
  readonly submissions: readonly EvaluationAssignmentSubmission[];
}

export interface BulkAssignmentInput {
  readonly eventId: string;
  readonly roundId: string;
  readonly submissionIds: readonly string[];
}

export interface AssignReviewersInput extends BulkAssignmentInput {
  readonly reviewerId: string;
}

export interface ReassignReviewersInput extends AssignReviewersInput {
  readonly fromReviewerId: string;
}

export interface WithdrawReviewersInput extends BulkAssignmentInput {
  readonly reviewerId: string;
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function conflict(message: string): never {
  throw new RepositoryError("conflict", message);
}

function uniqueSubmissionIds(submissionIds: readonly string[]): string[] {
  const normalized = submissionIds.map((id) => id.trim()).filter(Boolean);
  const unique = [...new Set(normalized)];
  if (unique.length === 0) invalid("Select at least one submission.");
  if (unique.length !== normalized.length) invalid("Each submission may be selected only once.");
  return unique;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") conflict("That reviewer already has an assignment for one of the selected submissions.");
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned evaluation record was not found.");
    }
  }
  throw error;
}

async function requireOpenRound(client: DatabaseClient, eventId: string, roundId: string): Promise<void> {
  const round = await client.evaluationRound.findFirst({
    where: {
      id: roundId,
      status: EvaluationRoundStatus.OPEN,
      planVersion: { status: EvaluationPlanVersionStatus.ACTIVE, plan: { eventId } },
    },
    select: { id: true },
  });
  if (!round) invalid("Assignments can only be changed in an open round for this event.");
}

async function requireReviewer(
  client: DatabaseClient,
  eventId: string,
  reviewerId: string,
  requireActive = true,
): Promise<void> {
  const reviewer = await client.evaluationReviewer.findFirst({
    where: {
      id: reviewerId,
      eventId,
      ...(requireActive ? { status: EvaluationReviewerStatus.ACTIVE } : {}),
    },
    select: { id: true },
  });
  if (!reviewer) {
    invalid(requireActive ? "Select an active reviewer from this event." : "Select a reviewer from this event.");
  }
}

async function requireEligibleSubmissions(
  client: DatabaseClient,
  eventId: string,
  submissionIds: readonly string[],
): Promise<void> {
  const submissions = await client.cfpSubmission.findMany({
    where: { eventId, id: { in: [...submissionIds] }, status: { in: [...eligibleSubmissionStatuses] } },
    select: { id: true },
  });
  if (submissions.length !== submissionIds.length) {
    invalid("Only submitted or under-review submissions from this event are eligible for assignment.");
  }
}

function speakerName(
  participant:
    | {
        readonly speaker: {
          readonly profileVersions: readonly {
            readonly givenName: string;
            readonly familyName: string;
            readonly preferredName: string | null;
          }[];
        };
      }
    | undefined,
): string | null {
  const profile = participant?.speaker.profileVersions[0];
  if (!profile) return null;
  return profile.preferredName ?? `${profile.givenName} ${profile.familyName}`;
}

export class EvaluationAssignmentRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async getWorkspace(eventId: string, selectedRoundId?: string): Promise<EvaluationAssignmentWorkspace> {
    const [rounds, reviewers] = await Promise.all([
      this.client.evaluationRound.findMany({
        where: {
          status: EvaluationRoundStatus.OPEN,
          planVersion: { status: EvaluationPlanVersionStatus.ACTIVE, plan: { eventId } },
        },
        orderBy: [{ planVersion: { versionNumber: "desc" } }, { sortOrder: "asc" }],
        select: { id: true, title: true, planVersion: { select: { title: true } } },
      }),
      this.client.evaluationReviewer.findMany({
        where: { eventId, status: EvaluationReviewerStatus.ACTIVE },
        orderBy: [{ displayName: "asc" }, { email: "asc" }],
        select: { id: true, displayName: true, email: true },
      }),
    ]);

    const selectedRound = selectedRoundId ? rounds.find(({ id }) => id === selectedRoundId) : rounds[0];
    if (selectedRoundId && !selectedRound) {
      throw new RepositoryError("not-found", "The selected open evaluation round was not found for this event.");
    }
    if (!selectedRound) {
      return {
        rounds: rounds.map(({ id, title, planVersion }) => ({ id, title, planTitle: planVersion.title })),
        selectedRoundId: null,
        reviewers,
        submissions: [],
      };
    }

    const submissions = await this.client.cfpSubmission.findMany({
      where: { eventId, status: { in: [...eligibleSubmissionStatuses] } },
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        kind: true,
        status: true,
        formVersion: { select: { title: true } },
        categories: { orderBy: { sortOrder: "asc" }, select: { category: { select: { label: true } } } },
        participants: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          select: {
            speaker: {
              select: {
                profileVersions: {
                  orderBy: { versionNumber: "desc" },
                  take: 1,
                  select: { givenName: true, familyName: true, preferredName: true },
                },
              },
            },
          },
        },
        evaluationAssignments: {
          where: { roundId: selectedRound.id, status: { not: EvaluationAssignmentStatus.REVOKED } },
          orderBy: { assignedAt: "asc" },
          select: {
            id: true,
            reviewerId: true,
            status: true,
            reviewer: { select: { displayName: true } },
          },
        },
      },
    });

    return {
      rounds: rounds.map(({ id, title, planVersion }) => ({ id, title, planTitle: planVersion.title })),
      selectedRoundId: selectedRound.id,
      reviewers,
      submissions: submissions.map((submission) => ({
        id: submission.id,
        kind: submission.kind,
        status: submission.status,
        formTitle: submission.formVersion.title,
        primarySpeaker: speakerName(submission.participants[0]),
        categories: submission.categories.map(({ category }) => category.label),
        assignments: submission.evaluationAssignments.map((assignment) => ({
          id: assignment.id,
          reviewerId: assignment.reviewerId,
          reviewerName: assignment.reviewer.displayName,
          status: assignment.status,
        })),
      })),
    };
  }

  async assign(input: AssignReviewersInput): Promise<number> {
    const submissionIds = uniqueSubmissionIds(input.submissionIds);
    try {
      return await this.client.$transaction(async (transaction) => {
        await Promise.all([
          requireOpenRound(transaction, input.eventId, input.roundId),
          requireReviewer(transaction, input.eventId, input.reviewerId),
          requireEligibleSubmissions(transaction, input.eventId, submissionIds),
        ]);
        const existing = await transaction.evaluationAssignment.findMany({
          where: { roundId: input.roundId, reviewerId: input.reviewerId, submissionId: { in: submissionIds } },
        });
        for (const assignment of existing) {
          if (assignment.status === EvaluationAssignmentStatus.ASSIGNED) {
            conflict("That reviewer already has an active assignment for one of the selected submissions.");
          }
          if (assignment.status === EvaluationAssignmentStatus.COMPLETED) {
            conflict("A completed reviewer assignment cannot be reopened.");
          }
        }
        const existingBySubmission = new Map(existing.map((assignment) => [assignment.submissionId, assignment]));
        for (const submissionId of submissionIds) {
          const assignment = existingBySubmission.get(submissionId);
          if (assignment) {
            await transaction.evaluationAssignment.update({
              where: { id: assignment.id },
              data: {
                status: EvaluationAssignmentStatus.ASSIGNED,
                assignedAt: new Date(),
                completedAt: null,
                revokedAt: null,
              },
            });
          } else {
            await transaction.evaluationAssignment.create({
              data: { roundId: input.roundId, submissionId, reviewerId: input.reviewerId },
            });
          }
        }
        return submissionIds.length;
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async reassign(input: ReassignReviewersInput): Promise<number> {
    const submissionIds = uniqueSubmissionIds(input.submissionIds);
    if (input.fromReviewerId === input.reviewerId) invalid("Choose a different reviewer for reassignment.");
    try {
      return await this.client.$transaction(async (transaction) => {
        await Promise.all([
          requireOpenRound(transaction, input.eventId, input.roundId),
          requireReviewer(transaction, input.eventId, input.fromReviewerId, false),
          requireReviewer(transaction, input.eventId, input.reviewerId),
          requireEligibleSubmissions(transaction, input.eventId, submissionIds),
        ]);
        const [sources, targets] = await Promise.all([
          transaction.evaluationAssignment.findMany({
            where: {
              roundId: input.roundId,
              reviewerId: input.fromReviewerId,
              submissionId: { in: submissionIds },
              status: EvaluationAssignmentStatus.ASSIGNED,
            },
          }),
          transaction.evaluationAssignment.findMany({
            where: { roundId: input.roundId, reviewerId: input.reviewerId, submissionId: { in: submissionIds } },
          }),
        ]);
        if (sources.length !== submissionIds.length) {
          invalid("The source reviewer must have an active assignment for every selected submission.");
        }
        for (const assignment of targets) {
          if (assignment.status === EvaluationAssignmentStatus.ASSIGNED) {
            conflict("The replacement reviewer already has an active assignment for one of the selected submissions.");
          }
          if (assignment.status === EvaluationAssignmentStatus.COMPLETED) {
            conflict("A completed reviewer assignment cannot be reopened.");
          }
        }
        const now = new Date();
        await transaction.evaluationAssignment.updateMany({
          where: { id: { in: sources.map(({ id }) => id) } },
          data: { status: EvaluationAssignmentStatus.REVOKED, revokedAt: now },
        });
        const targetsBySubmission = new Map(targets.map((assignment) => [assignment.submissionId, assignment]));
        for (const submissionId of submissionIds) {
          const target = targetsBySubmission.get(submissionId);
          if (target) {
            await transaction.evaluationAssignment.update({
              where: { id: target.id },
              data: {
                status: EvaluationAssignmentStatus.ASSIGNED,
                assignedAt: now,
                completedAt: null,
                revokedAt: null,
              },
            });
          } else {
            await transaction.evaluationAssignment.create({
              data: { roundId: input.roundId, submissionId, reviewerId: input.reviewerId, assignedAt: now },
            });
          }
        }
        return submissionIds.length;
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async withdraw(input: WithdrawReviewersInput): Promise<number> {
    const submissionIds = uniqueSubmissionIds(input.submissionIds);
    try {
      return await this.client.$transaction(async (transaction) => {
        await Promise.all([
          requireOpenRound(transaction, input.eventId, input.roundId),
          requireReviewer(transaction, input.eventId, input.reviewerId, false),
          requireEligibleSubmissions(transaction, input.eventId, submissionIds),
        ]);
        const assignments = await transaction.evaluationAssignment.findMany({
          where: {
            roundId: input.roundId,
            reviewerId: input.reviewerId,
            submissionId: { in: submissionIds },
            status: EvaluationAssignmentStatus.ASSIGNED,
          },
          select: { id: true },
        });
        if (assignments.length !== submissionIds.length) {
          invalid("The reviewer must have an active assignment for every selected submission.");
        }
        await transaction.evaluationAssignment.updateMany({
          where: { id: { in: assignments.map(({ id }) => id) } },
          data: { status: EvaluationAssignmentStatus.REVOKED, revokedAt: new Date() },
        });
        return submissionIds.length;
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
