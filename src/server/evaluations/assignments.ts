import {
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  EvaluationStatus,
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

export interface EvaluationCommitteeOption {
  readonly id: string;
  readonly name: string;
  readonly activeMemberCount: number;
}

export interface EvaluationTrackOption {
  readonly id: string;
  readonly label: string;
}

export type EvaluationCoverageStatus = "UNDER_ASSIGNED" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETE";

export interface EvaluationCoverageCounts {
  readonly underAssigned: number;
  readonly assigned: number;
  readonly inProgress: number;
  readonly complete: number;
}

export interface EvaluationAssignmentSubmission {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly formTitle: string;
  readonly primarySpeaker: string | null;
  readonly categories: readonly string[];
  readonly coverageStatus: EvaluationCoverageStatus;
  readonly completedAssignmentCount: number;
  readonly assignments: readonly {
    readonly id: string;
    readonly reviewerId: string;
    readonly reviewerName: string;
    readonly committeeName: string | null;
    readonly status: string;
    readonly evaluationVersion: number | null;
  }[];
}

export interface EvaluationAssignmentWorkspace {
  readonly rounds: readonly EvaluationRoundOption[];
  readonly selectedRoundId: string | null;
  readonly reviewers: readonly EvaluationReviewerOption[];
  readonly committees: readonly EvaluationCommitteeOption[];
  readonly tracks: readonly EvaluationTrackOption[];
  readonly coverage: EvaluationCoverageCounts;
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

export interface AssignCommitteeInput extends BulkAssignmentInput {
  readonly committeeId: string;
}

export interface ReassignReviewersInput extends AssignReviewersInput {
  readonly fromReviewerId: string;
}

export interface WithdrawReviewersInput extends BulkAssignmentInput {
  readonly reviewerId: string;
}

export interface AutoDistributeReviewersInput {
  readonly eventId: string;
  readonly roundId: string;
  readonly reviewerIds: readonly string[];
  readonly perReviewerCap?: number;
  readonly trackId?: string;
}

export interface AutoDistributionResult {
  readonly assignmentsCreated: number;
  readonly submissionsSkipped: number;
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

function uniqueReviewerIds(reviewerIds: readonly string[]): string[] {
  const normalized = reviewerIds.map((id) => id.trim()).filter(Boolean);
  const unique = [...new Set(normalized)];
  if (unique.length === 0) invalid("Select at least one reviewer.");
  if (unique.length !== normalized.length) invalid("Each reviewer may be selected only once.");
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
  roundId: string,
  submissionIds: readonly string[],
): Promise<void> {
  const round = await client.evaluationRound.findFirst({
    where: { id: roundId, planVersion: { plan: { eventId } } },
    select: { planVersionId: true, sortOrder: true },
  });
  if (!round) invalid("Select an evaluation round from this event.");
  const earlierRound = await client.evaluationRound.findFirst({
    where: { planVersionId: round.planVersionId, sortOrder: { lt: round.sortOrder } },
    select: { id: true },
  });
  const submissions = await client.cfpSubmission.findMany({
    where: {
      eventId,
      id: { in: [...submissionIds] },
      status: { in: [...eligibleSubmissionStatuses] },
      ...(earlierRound ? { evaluationAdvancements: { some: { targetRoundId: roundId } } } : {}),
    },
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

function coverageStatus(
  assignments: readonly {
    readonly status: EvaluationAssignmentStatus;
    readonly evaluation: { status: EvaluationStatus } | null;
  }[],
): EvaluationCoverageStatus {
  if (assignments.length === 0) return "UNDER_ASSIGNED";
  if (assignments.every(({ status }) => status === EvaluationAssignmentStatus.COMPLETED)) return "COMPLETE";
  if (
    assignments.some(
      ({ evaluation, status }) =>
        evaluation?.status === EvaluationStatus.DRAFT || status === EvaluationAssignmentStatus.COMPLETED,
    )
  ) {
    return "IN_PROGRESS";
  }
  return "ASSIGNED";
}

function countCoverage(submissions: readonly EvaluationAssignmentSubmission[]): EvaluationCoverageCounts {
  const counts = { underAssigned: 0, assigned: 0, inProgress: 0, complete: 0 };
  for (const submission of submissions) {
    if (submission.coverageStatus === "UNDER_ASSIGNED") counts.underAssigned += 1;
    else if (submission.coverageStatus === "ASSIGNED") counts.assigned += 1;
    else if (submission.coverageStatus === "IN_PROGRESS") counts.inProgress += 1;
    else counts.complete += 1;
  }
  return counts;
}

export class EvaluationAssignmentRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async getWorkspace(eventId: string, selectedRoundId?: string): Promise<EvaluationAssignmentWorkspace> {
    const [rounds, reviewers, committees, tracks] = await Promise.all([
      this.client.evaluationRound.findMany({
        where: {
          status: EvaluationRoundStatus.OPEN,
          planVersion: { status: EvaluationPlanVersionStatus.ACTIVE, plan: { eventId } },
        },
        orderBy: [{ planVersion: { versionNumber: "desc" } }, { sortOrder: "asc" }],
        select: {
          id: true,
          title: true,
          sortOrder: true,
          planVersionId: true,
          planVersion: { select: { title: true } },
        },
      }),
      this.client.evaluationReviewer.findMany({
        where: { eventId, status: EvaluationReviewerStatus.ACTIVE },
        orderBy: [{ displayName: "asc" }, { email: "asc" }],
        select: { id: true, displayName: true, email: true },
      }),
      this.client.evaluationCommittee.findMany({
        where: { eventId, members: { some: { reviewer: { status: EvaluationReviewerStatus.ACTIVE } } } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          members: {
            where: { reviewer: { status: EvaluationReviewerStatus.ACTIVE } },
            select: { reviewerId: true },
          },
        },
      }),
      this.client.cfpCategory.findMany({
        where: { eventId },
        orderBy: { label: "asc" },
        select: { id: true, label: true },
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
        committees: committees.map(({ id, name, members }) => ({ id, name, activeMemberCount: members.length })),
        tracks,
        coverage: { underAssigned: 0, assigned: 0, inProgress: 0, complete: 0 },
        submissions: [],
      };
    }

    const submissions = await this.client.cfpSubmission.findMany({
      where: {
        eventId,
        status: { in: [...eligibleSubmissionStatuses] },
        ...((await this.client.evaluationRound.findFirst({
          where: { planVersionId: selectedRound.planVersionId, sortOrder: { lt: selectedRound.sortOrder } },
          select: { id: true },
        }))
          ? { evaluationAdvancements: { some: { targetRoundId: selectedRound.id } } }
          : {}),
      },
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
            committee: { select: { name: true } },
            evaluation: { select: { status: true, version: true } },
          },
        },
      },
    });

    const mappedSubmissions = submissions.map((submission) => ({
      id: submission.id,
      kind: submission.kind,
      status: submission.status,
      formTitle: submission.formVersion.title,
      primarySpeaker: speakerName(submission.participants[0]),
      categories: submission.categories.map(({ category }) => category.label),
      coverageStatus: coverageStatus(submission.evaluationAssignments),
      completedAssignmentCount: submission.evaluationAssignments.filter(
        ({ status }) => status === EvaluationAssignmentStatus.COMPLETED,
      ).length,
      assignments: submission.evaluationAssignments.map((assignment) => ({
        id: assignment.id,
        reviewerId: assignment.reviewerId,
        reviewerName: assignment.reviewer.displayName,
        committeeName: assignment.committee?.name ?? null,
        status: assignment.status,
        evaluationVersion: assignment.evaluation?.version ?? null,
      })),
    }));

    return {
      rounds: rounds.map(({ id, title, planVersion }) => ({ id, title, planTitle: planVersion.title })),
      selectedRoundId: selectedRound.id,
      reviewers,
      committees: committees.map(({ id, name, members }) => ({ id, name, activeMemberCount: members.length })),
      tracks,
      coverage: countCoverage(mappedSubmissions),
      submissions: mappedSubmissions,
    };
  }

  async autoDistribute(input: AutoDistributeReviewersInput): Promise<AutoDistributionResult> {
    const reviewerIds = uniqueReviewerIds(input.reviewerIds);
    if (input.perReviewerCap !== undefined && (!Number.isInteger(input.perReviewerCap) || input.perReviewerCap < 1)) {
      invalid("The per-reviewer cap must be a positive whole number.");
    }

    try {
      return await this.client.$transaction(async (transaction) => {
        await requireOpenRound(transaction, input.eventId, input.roundId);
        const reviewers = await transaction.evaluationReviewer.findMany({
          where: { eventId: input.eventId, id: { in: reviewerIds }, status: EvaluationReviewerStatus.ACTIVE },
          select: { id: true },
        });
        if (reviewers.length !== reviewerIds.length) invalid("Select only active reviewers from this event.");

        if (input.trackId) {
          const track = await transaction.cfpCategory.findFirst({
            where: { id: input.trackId, eventId: input.eventId },
            select: { id: true },
          });
          if (!track) invalid("Select a track from this event.");
        }

        const round = await transaction.evaluationRound.findFirst({
          where: { id: input.roundId, planVersion: { plan: { eventId: input.eventId } } },
          select: { planVersionId: true, sortOrder: true },
        });
        if (!round) invalid("Select an evaluation round from this event.");
        const earlierRound = await transaction.evaluationRound.findFirst({
          where: { planVersionId: round.planVersionId, sortOrder: { lt: round.sortOrder } },
          select: { id: true },
        });
        const submissions = await transaction.cfpSubmission.findMany({
          where: {
            eventId: input.eventId,
            status: { in: [...eligibleSubmissionStatuses] },
            ...(earlierRound ? { evaluationAdvancements: { some: { targetRoundId: input.roundId } } } : {}),
            ...(input.trackId ? { categories: { some: { categoryId: input.trackId } } } : {}),
          },
          orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });

        const existing = await transaction.evaluationAssignment.findMany({
          where: { roundId: input.roundId, reviewerId: { in: reviewerIds } },
          select: { id: true, reviewerId: true, submissionId: true, status: true },
        });
        const activeStatuses = new Set<EvaluationAssignmentStatus>([
          EvaluationAssignmentStatus.ASSIGNED,
          EvaluationAssignmentStatus.COMPLETED,
        ]);
        const loads = new Map(reviewerIds.map((reviewerId) => [reviewerId, 0]));
        const coveredSubmissionIds = new Set<string>();
        const existingByPair = new Map<string, (typeof existing)[number]>();
        for (const assignment of existing) {
          existingByPair.set(`${assignment.submissionId}:${assignment.reviewerId}`, assignment);
          if (!activeStatuses.has(assignment.status)) continue;
          loads.set(assignment.reviewerId, (loads.get(assignment.reviewerId) ?? 0) + 1);
          coveredSubmissionIds.add(assignment.submissionId);
        }

        let assignmentsCreated = 0;
        let submissionsSkipped = 0;
        const now = new Date();
        for (const submission of submissions) {
          if (coveredSubmissionIds.has(submission.id)) continue;
          const reviewerId = reviewerIds
            .filter((id) => input.perReviewerCap === undefined || (loads.get(id) ?? 0) < input.perReviewerCap)
            .sort((left, right) => (loads.get(left) ?? 0) - (loads.get(right) ?? 0))[0];
          if (!reviewerId) {
            submissionsSkipped += 1;
            continue;
          }

          const prior = existingByPair.get(`${submission.id}:${reviewerId}`);
          if (prior) {
            await transaction.evaluationAssignment.update({
              where: { id: prior.id },
              data: {
                committeeId: null,
                status: EvaluationAssignmentStatus.ASSIGNED,
                assignedAt: now,
                completedAt: null,
                revokedAt: null,
              },
            });
          } else {
            await transaction.evaluationAssignment.create({
              data: { roundId: input.roundId, submissionId: submission.id, reviewerId, assignedAt: now },
            });
          }
          loads.set(reviewerId, (loads.get(reviewerId) ?? 0) + 1);
          assignmentsCreated += 1;
        }

        return { assignmentsCreated, submissionsSkipped };
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async assignCommittee(input: AssignCommitteeInput): Promise<number> {
    const submissionIds = uniqueSubmissionIds(input.submissionIds);
    try {
      return await this.client.$transaction(async (transaction) => {
        await Promise.all([
          requireOpenRound(transaction, input.eventId, input.roundId),
          requireEligibleSubmissions(transaction, input.eventId, input.roundId, submissionIds),
        ]);
        const committee = await transaction.evaluationCommittee.findFirst({
          where: { id: input.committeeId, eventId: input.eventId },
          select: {
            id: true,
            members: {
              where: { reviewer: { status: EvaluationReviewerStatus.ACTIVE } },
              select: { reviewerId: true },
            },
          },
        });
        if (!committee) invalid("Select a reviewer committee from this event.");
        if (committee.members.length === 0) invalid("The selected committee has no active reviewers.");

        const reviewerIds = committee.members.map(({ reviewerId }) => reviewerId);
        const existing = await transaction.evaluationAssignment.findMany({
          where: { roundId: input.roundId, submissionId: { in: submissionIds }, reviewerId: { in: reviewerIds } },
        });
        const existingByPair = new Map(
          existing.map((assignment) => [`${assignment.submissionId}:${assignment.reviewerId}`, assignment]),
        );
        let changed = 0;
        for (const submissionId of submissionIds) {
          for (const reviewerId of reviewerIds) {
            const assignment = existingByPair.get(`${submissionId}:${reviewerId}`);
            if (!assignment) {
              await transaction.evaluationAssignment.create({
                data: { roundId: input.roundId, submissionId, reviewerId, committeeId: committee.id },
              });
              changed += 1;
            } else if (assignment.status === EvaluationAssignmentStatus.REVOKED) {
              await transaction.evaluationAssignment.update({
                where: { id: assignment.id },
                data: {
                  committeeId: committee.id,
                  status: EvaluationAssignmentStatus.ASSIGNED,
                  assignedAt: new Date(),
                  completedAt: null,
                  revokedAt: null,
                },
              });
              changed += 1;
            }
          }
        }
        return changed;
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async assign(input: AssignReviewersInput): Promise<number> {
    const submissionIds = uniqueSubmissionIds(input.submissionIds);
    try {
      return await this.client.$transaction(async (transaction) => {
        await Promise.all([
          requireOpenRound(transaction, input.eventId, input.roundId),
          requireReviewer(transaction, input.eventId, input.reviewerId),
          requireEligibleSubmissions(transaction, input.eventId, input.roundId, submissionIds),
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
                committeeId: null,
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
          requireEligibleSubmissions(transaction, input.eventId, input.roundId, submissionIds),
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
                committeeId: null,
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
          requireEligibleSubmissions(transaction, input.eventId, input.roundId, submissionIds),
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

  async reopenEvaluation(
    eventId: string,
    assignmentId: string,
    input: {
      readonly actorId: string;
      readonly expectedEvaluationVersion: number;
      readonly note?: string | null;
    },
  ): Promise<void> {
    try {
      await this.client.$transaction(async (transaction) => {
        const actorId = input.actorId.trim();
        if (actorId === "") invalid("Actor is required.");
        const assignment = await transaction.evaluationAssignment.findFirst({
          where: { id: assignmentId, round: { planVersion: { plan: { eventId } } } },
          select: {
            id: true,
            status: true,
            submissionId: true,
            round: { select: { id: true, status: true } },
            evaluation: { select: { id: true, status: true, version: true } },
          },
        });
        if (!assignment) throw new RepositoryError("not-found", "The event-owned reviewer assignment was not found.");
        const existingReturn = await transaction.evaluationCorrectionReturn.findUnique({
          where: {
            assignmentId_evaluationVersion: {
              assignmentId: assignment.id,
              evaluationVersion: input.expectedEvaluationVersion,
            },
          },
        });
        if (existingReturn) {
          // The assignment snapshot above may predate the commit that wrote this return row, so a
          // concurrent retry would judge idempotency against a stale FINAL evaluation and reject a
          // return it had itself just applied. Read the evaluation again before deciding.
          const evaluation = assignment.evaluation
            ? await transaction.evaluation.findUnique({
                where: { id: assignment.evaluation.id },
                select: { status: true, version: true },
              })
            : null;
          if (
            evaluation?.status === EvaluationStatus.DRAFT &&
            evaluation.version === input.expectedEvaluationVersion + 1
          ) {
            return;
          }
          invalid("The evaluation changed after this correction return was applied.");
        }
        if (assignment.round.status !== EvaluationRoundStatus.OPEN) {
          invalid("Evaluations can only be returned while their round is open.");
        }
        const advancement = await transaction.evaluationRoundAdvancement.findUnique({
          where: {
            sourceRoundId_submissionId: {
              sourceRoundId: assignment.round.id,
              submissionId: assignment.submissionId,
            },
          },
          select: { id: true },
        });
        if (advancement) invalid("An advanced submission cannot be returned for correction in its earlier round.");
        if (assignment.evaluation?.version !== input.expectedEvaluationVersion) {
          invalid("The evaluation changed while the correction return was being applied.");
        }
        if (!assignment.evaluation || assignment.evaluation.status !== EvaluationStatus.FINAL) {
          invalid("Only a finalized evaluation can be reopened.");
        }
        if (assignment.status !== EvaluationAssignmentStatus.COMPLETED) {
          invalid("Only a completed reviewer assignment can be returned for correction.");
        }
        const evaluation = await transaction.evaluation.updateMany({
          where: {
            id: assignment.evaluation.id,
            status: EvaluationStatus.FINAL,
            version: input.expectedEvaluationVersion,
          },
          data: { status: EvaluationStatus.DRAFT, submittedAt: null, version: { increment: 1 } },
        });
        if (evaluation.count !== 1) {
          const concurrentReturn = await transaction.evaluationCorrectionReturn.findUnique({
            where: {
              assignmentId_evaluationVersion: {
                assignmentId: assignment.id,
                evaluationVersion: input.expectedEvaluationVersion,
              },
            },
          });
          if (concurrentReturn) return;
          invalid("The evaluation changed while the correction return was being applied.");
        }
        await transaction.evaluationAssignment.update({
          where: { id: assignment.id },
          data: { status: EvaluationAssignmentStatus.ASSIGNED, completedAt: null },
        });
        await transaction.evaluationCorrectionReturn.create({
          data: {
            assignmentId: assignment.id,
            evaluationVersion: input.expectedEvaluationVersion,
            actorId,
            note: input.note?.trim() || null,
          },
        });
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }
}
