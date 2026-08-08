import type { EvaluationPlanVersionStatus, Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface EvaluationCriterionInput {
  readonly key: string;
  readonly label: string;
  readonly description?: string | null;
  readonly minimum: number;
  readonly maximum: number;
  readonly weight: number;
  readonly required: boolean;
}

export interface EvaluationCriterionRecord extends EvaluationCriterionInput {
  readonly id: string;
  readonly roundId: string;
  readonly sortOrder: number;
  readonly used: boolean;
}

export interface EvaluationRubricRound {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly criteria: readonly EvaluationCriterionRecord[];
}

export interface EvaluationRubricVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly status: EvaluationPlanVersionStatus;
  readonly rounds: readonly EvaluationRubricRound[];
}

export interface EvaluationRubricPlan {
  readonly id: string;
  readonly key: string;
  readonly versions: readonly EvaluationRubricVersion[];
}

export const DEFAULT_EVALUATION_CRITERIA: readonly EvaluationCriterionInput[] = [
  {
    key: "relevance",
    label: "Relevance",
    description: "How well the proposal fits the event and its audience.",
    minimum: 1,
    maximum: 5,
    weight: 1,
    required: true,
  },
  {
    key: "technical-depth",
    label: "Technical Depth",
    description: "The substance, specificity, and practical value of the proposed content.",
    minimum: 1,
    maximum: 5,
    weight: 1,
    required: true,
  },
  {
    key: "speaker-authority",
    label: "Speaker Authority",
    description: "The speaker's demonstrated experience with the subject.",
    minimum: 1,
    maximum: 5,
    weight: 1,
    required: true,
  },
] as const;

const planInclude = {
  versions: {
    orderBy: { versionNumber: "desc" },
    include: {
      rounds: {
        orderBy: { sortOrder: "asc" },
        include: {
          criteria: {
            orderBy: { sortOrder: "asc" },
            include: { _count: { select: { results: true } } },
          },
        },
      },
    },
  },
} as const satisfies Prisma.EvaluationPlanInclude;

type StoredPlan = Prisma.EvaluationPlanGetPayload<{ include: typeof planInclude }>;
type EvaluationTransaction = Prisma.TransactionClient;

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new RepositoryError("invalid-input", `${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function validateInput(input: EvaluationCriterionInput): EvaluationCriterionInput {
  const key = requiredText(input.key, "Criterion key").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new RepositoryError("invalid-input", "Criterion key must use lowercase letters, numbers, and hyphens.");
  }
  if (!Number.isFinite(input.minimum) || !Number.isFinite(input.maximum) || input.maximum <= input.minimum) {
    throw new RepositoryError("invalid-input", "Maximum score must be greater than minimum score.");
  }
  if (!Number.isFinite(input.weight) || input.weight <= 0) {
    throw new RepositoryError("invalid-input", "Criterion weight must be greater than zero.");
  }
  return {
    key,
    label: requiredText(input.label, "Criterion label"),
    description: optionalText(input.description),
    minimum: input.minimum,
    maximum: input.maximum,
    weight: input.weight,
    required: input.required,
  };
}

function fromStored(plan: StoredPlan): EvaluationRubricPlan {
  return {
    id: plan.id,
    key: plan.key,
    versions: plan.versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      title: version.title,
      status: version.status,
      rounds: version.rounds.map((round) => ({
        id: round.id,
        key: round.key,
        title: round.title,
        sortOrder: round.sortOrder,
        criteria: round.criteria.map((criterion) => ({
          id: criterion.id,
          roundId: criterion.roundId,
          key: criterion.key,
          label: criterion.label,
          description: criterion.description,
          sortOrder: criterion.sortOrder,
          minimum: criterion.minimum.toNumber(),
          maximum: criterion.maximum.toNumber(),
          weight: criterion.weight.toNumber(),
          required: criterion.required,
          used: criterion._count.results > 0,
        })),
      })),
    })),
  };
}

async function requireDraftRound(
  transaction: EvaluationTransaction,
  eventId: string,
  roundId: string,
): Promise<{ readonly id: string; readonly criteria: readonly { readonly id: string; readonly sortOrder: number }[] }> {
  const round = await transaction.evaluationRound.findFirst({
    where: { id: roundId, planVersion: { plan: { eventId } } },
    select: {
      id: true,
      planVersion: { select: { status: true } },
      criteria: { orderBy: { sortOrder: "asc" }, select: { id: true, sortOrder: true } },
    },
  });
  if (!round) throw new RepositoryError("not-found", "The event-owned evaluation round was not found.");
  if (round.planVersion.status !== "DRAFT") {
    throw new RepositoryError("invalid-input", "Only draft plan versions can change rubric criteria.");
  }
  return round;
}

async function requireUnusedCriterion(transaction: EvaluationTransaction, eventId: string, criterionId: string) {
  const criterion = await transaction.evaluationCriterion.findFirst({
    where: { id: criterionId, round: { planVersion: { plan: { eventId } } } },
    include: {
      _count: { select: { results: true } },
      round: { select: { planVersion: { select: { status: true } } } },
    },
  });
  if (!criterion) throw new RepositoryError("not-found", "The event-owned rubric criterion was not found.");
  if (criterion.round.planVersion.status !== "DRAFT") {
    throw new RepositoryError("invalid-input", "Only draft plan versions can change rubric criteria.");
  }
  if (criterion._count.results > 0) {
    throw new RepositoryError("invalid-input", "Criteria already used by an evaluation cannot be changed.");
  }
  return criterion;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError(
        "conflict",
        "The rubric changed or a criterion key is already in use. Reload and try again.",
      );
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned rubric record was not found.");
    }
  }
  throw error;
}

export class EvaluationRubricRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async list(eventId: string): Promise<EvaluationRubricPlan[]> {
    const plans = await this.client.evaluationPlan.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      include: planInclude,
    });
    return plans.map(fromStored);
  }

  async add(eventId: string, roundId: string, input: EvaluationCriterionInput): Promise<void> {
    const definition = validateInput(input);
    try {
      await this.client.$transaction(async (transaction) => {
        const round = await requireDraftRound(transaction, eventId, roundId);
        await transaction.evaluationCriterion.create({
          data: { roundId, sortOrder: round.criteria.length, ...definition },
        });
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async addDefaults(eventId: string, roundId: string): Promise<void> {
    try {
      await this.client.$transaction(async (transaction) => {
        const round = await requireDraftRound(transaction, eventId, roundId);
        if (round.criteria.length > 0) {
          throw new RepositoryError("invalid-input", "Default criteria can only be added to an empty rubric.");
        }
        await transaction.evaluationCriterion.createMany({
          data: DEFAULT_EVALUATION_CRITERIA.map((criterion, sortOrder) => ({ roundId, sortOrder, ...criterion })),
        });
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async update(eventId: string, criterionId: string, input: EvaluationCriterionInput): Promise<void> {
    const definition = validateInput(input);
    try {
      await this.client.$transaction(async (transaction) => {
        const criterion = await requireUnusedCriterion(transaction, eventId, criterionId);
        await transaction.evaluationCriterion.update({ where: { id: criterion.id }, data: definition });
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async reorder(eventId: string, roundId: string, orderedIds: readonly string[]): Promise<void> {
    try {
      await this.client.$transaction(async (transaction) => {
        const round = await requireDraftRound(transaction, eventId, roundId);
        if (
          orderedIds.length !== round.criteria.length ||
          new Set(orderedIds).size !== orderedIds.length ||
          orderedIds.some((id) => !round.criteria.some((criterion) => criterion.id === id))
        ) {
          throw new RepositoryError("invalid-input", "The criterion order must include every round criterion once.");
        }
        const resultCount = await transaction.evaluationResult.count({
          where: { criterionId: { in: [...orderedIds] } },
        });
        if (resultCount > 0) {
          throw new RepositoryError("invalid-input", "Criteria already used by an evaluation cannot be reordered.");
        }
        const temporaryOffset = 1_000_000 + Math.max(0, ...round.criteria.map(({ sortOrder }) => sortOrder));
        for (const criterion of round.criteria) {
          await transaction.evaluationCriterion.update({
            where: { id: criterion.id },
            data: { sortOrder: criterion.sortOrder + temporaryOffset },
          });
        }
        for (const [sortOrder, id] of orderedIds.entries()) {
          await transaction.evaluationCriterion.update({ where: { id }, data: { sortOrder } });
        }
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }
}
