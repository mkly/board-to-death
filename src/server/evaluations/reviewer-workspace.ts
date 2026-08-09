import {
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  EvaluationStatus,
  type Prisma,
  type PrismaClient,
  ReviewerVisibility,
} from "../../generated/prisma/client.ts";
import { parseCfpDefinition } from "../../lib/cfp/index.ts";

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
      status: true,
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
    readonly results: readonly { readonly criterionId: string }[];
  } | null;
}) {
  const completedCriteria = new Set(assignment.evaluation?.results.map(({ criterionId }) => criterionId) ?? []).size;
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
          score: result?.score.toNumber() ?? null,
          note: result?.note ?? null,
        };
      }),
    };
  }
}
