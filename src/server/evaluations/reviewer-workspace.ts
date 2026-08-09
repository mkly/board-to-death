import {
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  type EvaluationRecommendation,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  EvaluationStatus,
  type Prisma,
  type PrismaClient,
  ReviewerVisibility,
} from "../../generated/prisma/client.ts";
import { parseCfpDefinition } from "../../lib/cfp/index.ts";
import { RepositoryError } from "../events/repositories.ts";

export type ReviewerProgressState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";

export interface ReviewerAssignmentSummary {
  readonly id: string;
  readonly event: { readonly name: string; readonly slug: string };
  readonly round: { readonly title: string; readonly planTitle: string };
  readonly formTitle: string;
  readonly categories: readonly string[];
  readonly visibility: ReviewerVisibility;
  readonly progress: {
    readonly state: ReviewerProgressState;
    readonly completedCriteria: number;
    readonly totalCriteria: number;
  };
  readonly assignedAt: Date;
}

export interface ReviewerAssignmentDetail extends ReviewerAssignmentSummary {
  readonly submission: {
    readonly reference: string;
    readonly kind: string;
    readonly applicants: readonly { readonly name: string; readonly email: string }[];
    readonly answers: readonly {
      readonly questionId: string;
      readonly label: string;
      readonly value: string;
    }[];
  };
  readonly evaluation: {
    readonly status: EvaluationStatus;
    readonly version: number;
    readonly overallNote: string | null;
    readonly recommendation: EvaluationRecommendation | null;
  };
  readonly criteria: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string | null;
    readonly minimum: number;
    readonly maximum: number;
    readonly weight: number;
    readonly required: boolean;
    readonly score: number | null;
    readonly note: string | null;
  }[];
}

export interface EvaluationDraftCriterionInput {
  readonly criterionId: string;
  readonly score: number | null;
  readonly note?: string | null;
}

export interface EvaluationDraftInput {
  readonly expectedVersion: number;
  readonly overallNote: string | null;
  readonly recommendation: EvaluationRecommendation | null;
  readonly criteria: readonly EvaluationDraftCriterionInput[];
}

export interface EvaluationSubmissionInput {
  readonly expectedVersion: number;
  readonly overallNote: string | null;
  readonly recommendation: EvaluationRecommendation;
  readonly criteria: readonly EvaluationDraftCriterionInput[];
}

const assignmentInclude = {
  reviewer: { select: { displayName: true } },
  round: {
    select: {
      title: true,
      reviewerVisibility: true,
      visibilitySnapshot: true,
      criteria: {
        orderBy: { sortOrder: "asc" as const },
        select: {
          id: true,
          label: true,
          description: true,
          minimum: true,
          maximum: true,
          weight: true,
          required: true,
        },
      },
      planVersion: {
        select: {
          title: true,
          plan: { select: { event: { select: { name: true, slug: true } } } },
        },
      },
    },
  },
  submission: {
    select: {
      id: true,
      kind: true,
      formVersion: { select: { title: true } },
      categories: {
        orderBy: { sortOrder: "asc" as const },
        select: { category: { select: { label: true } } },
      },
      revisions: {
        orderBy: { versionNumber: "desc" as const },
        take: 1,
        select: {
          definitionSnapshot: true,
          answers: {
            orderBy: { sortOrder: "asc" as const },
            select: { questionId: true, value: true },
          },
        },
      },
      participants: {
        orderBy: { sortOrder: "asc" as const },
        select: {
          speaker: {
            select: {
              profileVersions: {
                orderBy: { versionNumber: "desc" as const },
                take: 1,
                select: { email: true, givenName: true, familyName: true, preferredName: true },
              },
            },
          },
        },
      },
    },
  },
  evaluation: {
    select: {
      id: true,
      status: true,
      version: true,
      overallNote: true,
      recommendation: true,
      results: { select: { criterionId: true, score: true, note: true } },
    },
  },
} as const;

type IncludedAssignment = Prisma.EvaluationAssignmentGetPayload<{ include: typeof assignmentInclude }>;

function visibilityOf(assignment: {
  readonly round: {
    readonly visibilitySnapshot: ReviewerVisibility | null;
    readonly reviewerVisibility: ReviewerVisibility;
  };
}): ReviewerVisibility {
  return assignment.round.visibilitySnapshot ?? assignment.round.reviewerVisibility;
}

function progressOf(assignment: {
  readonly status: EvaluationAssignmentStatus;
  readonly round: { readonly criteria: readonly { readonly id: string }[] };
  readonly evaluation: {
    readonly status: EvaluationStatus;
    readonly results: readonly { readonly criterionId: string; readonly score: unknown }[];
  } | null;
}) {
  const completedCriteria = new Set(
    assignment.evaluation?.results.filter((result) => result.score !== null).map(({ criterionId }) => criterionId) ??
      [],
  ).size;
  let state: ReviewerProgressState = "NOT_STARTED";
  if (
    assignment.status === EvaluationAssignmentStatus.COMPLETED ||
    assignment.evaluation?.status === EvaluationStatus.FINAL
  ) {
    state = "COMPLETE";
  } else if (assignment.evaluation) {
    state = "IN_PROGRESS";
  }
  return { state, completedCriteria, totalCriteria: assignment.round.criteria.length };
}

function formatAnswer(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(formatAnswer).filter(Boolean).join(", ");
  return JSON.stringify(value);
}

function safeAnswers(
  revision:
    | {
        readonly definitionSnapshot: unknown;
        readonly answers: readonly { readonly questionId: string; readonly value: unknown }[];
      }
    | undefined,
  exposeIdentity: boolean,
): ReviewerAssignmentDetail["submission"]["answers"] {
  if (!revision) return [];
  const parsed = parseCfpDefinition(revision.definitionSnapshot);
  if (!parsed.ok) return [];

  const visibleQuestions = new Map(
    parsed.definition.sections
      .filter((section) => exposeIdentity || section.kind !== "speaker")
      .flatMap((section) => section.questions)
      .map((question) => [question.id, question.label]),
  );

  return revision.answers.flatMap((answer) => {
    const label = visibleQuestions.get(answer.questionId);
    return label ? [{ questionId: answer.questionId, label, value: formatAnswer(answer.value) }] : [];
  });
}

function applicantsOf(
  assignment: {
    readonly submission: {
      readonly participants: readonly {
        readonly speaker: {
          readonly profileVersions: readonly {
            readonly email: string;
            readonly givenName: string;
            readonly familyName: string;
            readonly preferredName: string | null;
          }[];
        };
      }[];
    };
  },
  exposeIdentity: boolean,
): ReviewerAssignmentDetail["submission"]["applicants"] {
  if (!exposeIdentity) return [];
  return assignment.submission.participants.flatMap(({ speaker }) => {
    const profile = speaker.profileVersions[0];
    if (!profile) return [];
    return [
      {
        name: profile.preferredName ?? `${profile.givenName} ${profile.familyName}`,
        email: profile.email,
      },
    ];
  });
}

type EvaluationTransaction = Prisma.TransactionClient;

interface MutableAssignment {
  readonly round: {
    readonly criteria: readonly {
      readonly id: string;
      readonly label: string;
      readonly minimum: number;
      readonly maximum: number;
      readonly required: boolean;
    }[];
  };
  readonly evaluation: {
    readonly id: string;
    readonly version: number;
    readonly results: readonly { readonly criterionId: string; readonly score: number | null }[];
  } | null;
}

async function loadMutableAssignment(
  transaction: EvaluationTransaction,
  identityId: string,
  assignmentId: string,
): Promise<MutableAssignment> {
  const assignment = await transaction.evaluationAssignment.findFirst({
    where: {
      id: assignmentId,
      status: { not: EvaluationAssignmentStatus.REVOKED },
      reviewer: { identityId, status: EvaluationReviewerStatus.ACTIVE },
      round: {
        status: EvaluationRoundStatus.OPEN,
        planVersion: { status: EvaluationPlanVersionStatus.ACTIVE },
      },
    },
    select: {
      round: {
        select: {
          criteria: { select: { id: true, label: true, minimum: true, maximum: true, required: true } },
        },
      },
      evaluation: {
        select: {
          id: true,
          status: true,
          version: true,
          results: { select: { criterionId: true, score: true } },
        },
      },
    },
  });
  if (!assignment) throw new RepositoryError("not-found", "The reviewer assignment was not found.");
  if (assignment.evaluation?.status === EvaluationStatus.FINAL) {
    throw new RepositoryError(
      "invalid-input",
      "This evaluation has been finalized and cannot be edited unless an administrator reopens it.",
    );
  }
  return {
    round: {
      criteria: assignment.round.criteria.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        minimum: criterion.minimum.toNumber(),
        maximum: criterion.maximum.toNumber(),
        required: criterion.required,
      })),
    },
    evaluation: assignment.evaluation
      ? {
          id: assignment.evaluation.id,
          version: assignment.evaluation.version,
          results: assignment.evaluation.results.map((result) => ({
            criterionId: result.criterionId,
            score: result.score?.toNumber() ?? null,
          })),
        }
      : null,
  };
}

function validateCriteria(criteria: readonly EvaluationDraftCriterionInput[], round: MutableAssignment["round"]): void {
  const byId = new Map(round.criteria.map((criterion) => [criterion.id, criterion]));
  for (const entry of criteria) {
    const criterion = byId.get(entry.criterionId);
    if (!criterion) throw new RepositoryError("invalid-input", "Unknown evaluation criterion.");
    if (entry.score === null) continue;
    if (!Number.isFinite(entry.score) || entry.score < criterion.minimum || entry.score > criterion.maximum) {
      throw new RepositoryError(
        "invalid-input",
        `Score for "${criterion.label}" must be between ${criterion.minimum} and ${criterion.maximum}.`,
      );
    }
  }
}

async function upsertEvaluation(
  transaction: EvaluationTransaction,
  assignmentId: string,
  mutable: MutableAssignment,
  expectedVersion: number,
  data: { readonly overallNote: string | null; readonly recommendation: EvaluationRecommendation | null },
): Promise<string> {
  const currentVersion = mutable.evaluation?.version ?? 0;
  if (expectedVersion !== currentVersion) {
    throw new RepositoryError("conflict", "This evaluation changed since you loaded it. Reload and try again.");
  }
  if (mutable.evaluation) {
    const updated = await transaction.evaluation.updateMany({
      where: { id: mutable.evaluation.id, version: expectedVersion, status: EvaluationStatus.DRAFT },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new RepositoryError("conflict", "This evaluation changed since you loaded it. Reload and try again.");
    }
    return mutable.evaluation.id;
  }
  const created = await transaction.evaluation.create({
    data: { assignmentId, status: EvaluationStatus.DRAFT, version: 1, ...data },
  });
  return created.id;
}

async function applyCriteria(
  transaction: EvaluationTransaction,
  evaluationId: string,
  criteria: readonly EvaluationDraftCriterionInput[],
): Promise<void> {
  for (const entry of criteria) {
    const note = entry.note ?? null;
    if (entry.score === null && !note) {
      await transaction.evaluationResult.deleteMany({
        where: { evaluationId, criterionId: entry.criterionId },
      });
      continue;
    }
    await transaction.evaluationResult.upsert({
      where: { evaluationId_criterionId: { evaluationId, criterionId: entry.criterionId } },
      create: { evaluationId, criterionId: entry.criterionId, score: entry.score, note },
      update: { score: entry.score, note },
    });
  }
}

function finalScoresOf(
  mutable: MutableAssignment,
  criteria: readonly EvaluationDraftCriterionInput[],
): Map<string, number | null> {
  const scores = new Map<string, number | null>(
    mutable.evaluation?.results.map((result) => [result.criterionId, result.score]) ?? [],
  );
  for (const entry of criteria) {
    scores.set(entry.criterionId, entry.score);
  }
  return scores;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002" || code === "P2025") {
      throw new RepositoryError("conflict", "This evaluation changed since you loaded it. Reload and try again.");
    }
  }
  throw error;
}

function referenceOf(assignment: IncludedAssignment, visibility: ReviewerVisibility): string {
  if (visibility !== ReviewerVisibility.IDENTIFIED) {
    return `Submission ${assignment.submission.id.slice(0, 8).toUpperCase()}`;
  }
  return (
    applicantsOf(assignment, true)
      .map(({ name }) => name)
      .join(", ") || "Identified submission"
  );
}

function summaryOf(assignment: IncludedAssignment): ReviewerAssignmentSummary {
  return {
    id: assignment.id,
    event: assignment.round.planVersion.plan.event,
    round: { title: assignment.round.title, planTitle: assignment.round.planVersion.title },
    formTitle: assignment.submission.formVersion.title,
    categories: assignment.submission.categories.map(({ category }) => category.label),
    visibility: visibilityOf(assignment),
    progress: progressOf(assignment),
    assignedAt: assignment.assignedAt,
  };
}

export class ReviewerWorkspaceRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async list(identityId: string): Promise<ReviewerAssignmentSummary[]> {
    const assignments = await this.client.evaluationAssignment.findMany({
      where: {
        status: { not: EvaluationAssignmentStatus.REVOKED },
        reviewer: { identityId, status: EvaluationReviewerStatus.ACTIVE },
        round: {
          status: EvaluationRoundStatus.OPEN,
          planVersion: { status: EvaluationPlanVersionStatus.ACTIVE },
        },
      },
      orderBy: [{ round: { planVersion: { plan: { event: { startsAt: "asc" } } } } }, { assignedAt: "asc" }],
      include: assignmentInclude,
    });
    return assignments.map(summaryOf);
  }

  async get(identityId: string, assignmentId: string): Promise<ReviewerAssignmentDetail | null> {
    const assignment = await this.client.evaluationAssignment.findFirst({
      where: {
        id: assignmentId,
        status: { not: EvaluationAssignmentStatus.REVOKED },
        reviewer: { identityId, status: EvaluationReviewerStatus.ACTIVE },
        round: {
          status: EvaluationRoundStatus.OPEN,
          planVersion: { status: EvaluationPlanVersionStatus.ACTIVE },
        },
      },
      include: assignmentInclude,
    });
    if (!assignment) return null;

    const visibility = visibilityOf(assignment);
    const exposeIdentity = visibility === ReviewerVisibility.IDENTIFIED;
    const results = new Map(assignment.evaluation?.results.map((result) => [result.criterionId, result]));
    return {
      ...summaryOf(assignment),
      submission: {
        reference: referenceOf(assignment, visibility),
        kind: assignment.submission.kind,
        applicants: applicantsOf(assignment, exposeIdentity),
        answers: safeAnswers(assignment.submission.revisions[0], exposeIdentity),
      },
      evaluation: {
        status: assignment.evaluation?.status ?? EvaluationStatus.DRAFT,
        version: assignment.evaluation?.version ?? 0,
        overallNote: assignment.evaluation?.overallNote ?? null,
        recommendation: assignment.evaluation?.recommendation ?? null,
      },
      criteria: assignment.round.criteria.map((criterion) => {
        const result = results.get(criterion.id);
        return {
          id: criterion.id,
          label: criterion.label,
          description: criterion.description,
          minimum: criterion.minimum.toNumber(),
          maximum: criterion.maximum.toNumber(),
          weight: criterion.weight.toNumber(),
          required: criterion.required,
          score: result?.score?.toNumber() ?? null,
          note: result?.note ?? null,
        };
      }),
    };
  }

  async saveDraft(identityId: string, assignmentId: string, input: EvaluationDraftInput): Promise<void> {
    try {
      await this.client.$transaction(async (transaction) => {
        const mutable = await loadMutableAssignment(transaction, identityId, assignmentId);
        validateCriteria(input.criteria, mutable.round);
        const evaluationId = await upsertEvaluation(transaction, assignmentId, mutable, input.expectedVersion, {
          overallNote: input.overallNote,
          recommendation: input.recommendation,
        });
        await applyCriteria(transaction, evaluationId, input.criteria);
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async submitFinal(identityId: string, assignmentId: string, input: EvaluationSubmissionInput): Promise<void> {
    try {
      await this.client.$transaction(async (transaction) => {
        const mutable = await loadMutableAssignment(transaction, identityId, assignmentId);
        validateCriteria(input.criteria, mutable.round);

        const finalScores = finalScoresOf(mutable, input.criteria);
        const missingRequired = mutable.round.criteria.some(
          (criterion) => criterion.required && finalScores.get(criterion.id) == null,
        );
        if (missingRequired) {
          throw new RepositoryError("invalid-input", "Every required criterion must have a score before submitting.");
        }

        const evaluationId = await upsertEvaluation(transaction, assignmentId, mutable, input.expectedVersion, {
          overallNote: input.overallNote,
          recommendation: input.recommendation,
        });
        await applyCriteria(transaction, evaluationId, input.criteria);

        const finalized = await transaction.evaluation.updateMany({
          where: { id: evaluationId, status: EvaluationStatus.DRAFT },
          data: { status: EvaluationStatus.FINAL, submittedAt: new Date() },
        });
        if (finalized.count === 0) {
          throw new RepositoryError("conflict", "This evaluation changed since you loaded it. Reload and try again.");
        }
        await transaction.evaluationAssignment.update({
          where: { id: assignmentId },
          data: { status: EvaluationAssignmentStatus.COMPLETED, completedAt: new Date() },
        });
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }
}
