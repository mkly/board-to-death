import {
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationRoundStatus,
  EvaluationStatus,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface EvaluationResultsRound {
  readonly id: string;
  readonly title: string;
  readonly status: EvaluationRoundStatus;
  readonly planTitle: string;
  readonly planVersionNumber: number;
}

export interface EvaluationCriterionAggregate {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly average: number | null;
  readonly scoreCount: number;
  readonly missingScoreCount: number;
}

export interface EvaluationSubmissionResult {
  readonly id: string;
  readonly reference: string;
  readonly formTitle: string;
  readonly primarySpeaker: string | null;
  readonly categories: readonly string[];
  readonly activeReviewerCount: number;
  readonly completedReviewerCount: number;
  readonly incompleteReviewerCount: number;
  readonly withdrawnReviewerCount: number;
  readonly criteria: readonly EvaluationCriterionAggregate[];
  readonly weightedAverage: number | null;
  readonly rank: number | null;
  readonly tied: boolean;
}

export interface EvaluationResultsWorkspace {
  readonly rounds: readonly EvaluationResultsRound[];
  readonly selectedRoundId: string | null;
  readonly criteria: readonly { readonly id: string; readonly label: string; readonly weight: number }[];
  readonly submissions: readonly EvaluationSubmissionResult[];
}

function roundScore(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

export class EvaluationResultsRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async getWorkspace(eventId: string, selectedRoundId?: string): Promise<EvaluationResultsWorkspace> {
    const rounds = await this.client.evaluationRound.findMany({
      where: {
        status: { not: EvaluationRoundStatus.PLANNED },
        planVersion: {
          status: EvaluationPlanVersionStatus.ACTIVE,
          plan: { eventId },
        },
      },
      orderBy: [{ planVersion: { activatedAt: "desc" } }, { sortOrder: "asc" }],
      select: {
        id: true,
        title: true,
        status: true,
        planVersion: { select: { title: true, versionNumber: true } },
        criteria: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, label: true, weight: true },
        },
      },
    });

    const selectedRound = selectedRoundId ? rounds.find(({ id }) => id === selectedRoundId) : rounds[0];
    if (selectedRoundId && !selectedRound) {
      throw new RepositoryError("not-found", "The selected activated evaluation round was not found for this event.");
    }

    const roundOptions = rounds.map(({ id, title, status, planVersion }) => ({
      id,
      title,
      status,
      planTitle: planVersion.title,
      planVersionNumber: planVersion.versionNumber,
    }));
    if (!selectedRound) {
      return { rounds: roundOptions, selectedRoundId: null, criteria: [], submissions: [] };
    }

    const criteria = selectedRound.criteria.map(({ id, label, weight }) => ({
      id,
      label,
      weight: weight.toNumber(),
    }));
    const submissions = await this.client.cfpSubmission.findMany({
      where: {
        eventId,
        evaluationAssignments: { some: { roundId: selectedRound.id } },
      },
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
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
          where: { roundId: selectedRound.id },
          orderBy: { assignedAt: "asc" },
          select: {
            status: true,
            evaluation: {
              select: {
                status: true,
                results: { select: { criterionId: true, score: true } },
              },
            },
          },
        },
      },
    });

    const mapped = submissions.map((submission): EvaluationSubmissionResult => {
      const activeAssignments = submission.evaluationAssignments.filter(
        ({ status }) => status !== EvaluationAssignmentStatus.REVOKED,
      );
      const completedReviewerCount = activeAssignments.filter(
        ({ evaluation, status }) =>
          status === EvaluationAssignmentStatus.COMPLETED && evaluation?.status === EvaluationStatus.FINAL,
      ).length;
      const calculatedCriteria = criteria.map((criterion) => {
        const scores = activeAssignments.flatMap(({ evaluation }) => {
          const score = evaluation?.results.find(({ criterionId }) => criterionId === criterion.id)?.score;
          return score === null || score === undefined ? [] : [score.toNumber()];
        });
        const rawAverage = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
        return {
          rawAverage,
          aggregate: {
            ...criterion,
            average: rawAverage === null ? null : roundScore(rawAverage),
            scoreCount: scores.length,
            missingScoreCount: activeAssignments.length - scores.length,
          } satisfies EvaluationCriterionAggregate,
        };
      });
      const scoredCriteria = calculatedCriteria.filter(
        (criterion): criterion is (typeof calculatedCriteria)[number] & { readonly rawAverage: number } =>
          criterion.rawAverage !== null,
      );
      const availableWeight = scoredCriteria.reduce((sum, criterion) => sum + criterion.aggregate.weight, 0);
      const weightedAverage =
        availableWeight > 0
          ? roundScore(
              scoredCriteria.reduce((sum, criterion) => sum + criterion.rawAverage * criterion.aggregate.weight, 0) /
                availableWeight,
            )
          : null;

      return {
        id: submission.id,
        reference: `Submission ${submission.id.slice(0, 8).toUpperCase()}`,
        formTitle: submission.formVersion.title,
        primarySpeaker: speakerName(submission.participants[0]),
        categories: submission.categories.map(({ category }) => category.label),
        activeReviewerCount: activeAssignments.length,
        completedReviewerCount,
        incompleteReviewerCount: activeAssignments.length - completedReviewerCount,
        withdrawnReviewerCount: submission.evaluationAssignments.length - activeAssignments.length,
        criteria: calculatedCriteria.map(({ aggregate }) => aggregate),
        weightedAverage,
        rank: null,
        tied: false,
      };
    });

    const comparableAverages = mapped.flatMap(({ weightedAverage }) =>
      weightedAverage === null ? [] : [weightedAverage],
    );
    const ranked = mapped.map((submission): EvaluationSubmissionResult => {
      if (submission.weightedAverage === null) return submission;
      const submissionAverage = submission.weightedAverage;
      return {
        ...submission,
        rank: 1 + comparableAverages.filter((average) => average > submissionAverage).length,
        tied: comparableAverages.filter((average) => average === submissionAverage).length > 1,
      };
    });

    ranked.sort((left, right) => {
      if (left.weightedAverage === null) return right.weightedAverage === null ? 0 : 1;
      if (right.weightedAverage === null) return -1;
      return right.weightedAverage - left.weightedAverage;
    });

    return {
      rounds: roundOptions,
      selectedRoundId: selectedRound.id,
      criteria,
      submissions: ranked,
    };
  }
}
