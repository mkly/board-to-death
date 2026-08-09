import type {
  EvaluationRound,
  EvaluationRoundStatus,
  Prisma,
  PrismaClient,
  ReviewerVisibility,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

const lifecycleInclude = {
  versions: {
    orderBy: { versionNumber: "desc" },
    include: {
      rounds: {
        orderBy: { sortOrder: "asc" },
        include: {
          transitions: { orderBy: { occurredAt: "asc" } },
          _count: { select: { criteria: true } },
        },
      },
    },
  },
} as const satisfies Prisma.EvaluationPlanInclude;

export type EvaluationPlanWithVersions = Prisma.EvaluationPlanGetPayload<{ include: typeof lifecycleInclude }>;

type EvaluationTransaction = Prisma.TransactionClient;
type LifecycleClient = PrismaClient | EvaluationTransaction;
type StoredRound = Prisma.EvaluationRoundGetPayload<{
  include: { planVersion: { include: { plan: true } } };
}>;

export interface CreateEvaluationPlanInput {
  readonly key: string;
  readonly title: string;
  readonly description?: string | null;
}

export interface CreateEvaluationRoundInput {
  readonly eventId: string;
  readonly planVersionId: string;
  readonly key: string;
  readonly title: string;
  readonly description?: string | null;
  readonly reviewerVisibility: ReviewerVisibility;
}

export interface UpdateEvaluationRoundInput {
  readonly key: string;
  readonly title: string;
  readonly description?: string | null;
  readonly reviewerVisibility: ReviewerVisibility;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new RepositoryError("invalid-input", `${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function stableKey(value: string, field: string): string {
  const key = requiredText(value, field).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new RepositoryError("invalid-input", `${field} must use lowercase letters, numbers, and single hyphens.`);
  }
  return key;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError("conflict", "The evaluation plan changed or a stable key is already in use.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned evaluation record was not found.");
    }
    if (code === "P2004") {
      throw new RepositoryError("invalid-input", "The evaluation lifecycle change violates its history rules.");
    }
  }
  throw error;
}

async function requirePlanVersion(client: LifecycleClient, eventId: string, planVersionId: string) {
  const version = await client.evaluationPlanVersion.findFirst({
    where: { id: planVersionId, plan: { eventId } },
    include: { plan: true },
  });
  if (!version) throw new RepositoryError("not-found", "The event-owned evaluation plan version was not found.");
  return version;
}

async function requireRound(client: LifecycleClient, eventId: string, roundId: string): Promise<StoredRound> {
  const round = await client.evaluationRound.findFirst({
    where: { id: roundId, planVersion: { plan: { eventId } } },
    include: { planVersion: { include: { plan: true } } },
  });
  if (!round) throw new RepositoryError("not-found", "The event-owned evaluation round was not found.");
  return round;
}

function requireDraftVersion(status: string): void {
  if (status !== "DRAFT") {
    throw new RepositoryError("invalid-input", "Only draft evaluation plan versions can change rounds.");
  }
}

export class EvaluationPlanRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async list(eventId: string): Promise<EvaluationPlanWithVersions[]> {
    return this.client.evaluationPlan.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      include: lifecycleInclude,
    });
  }

  async create(eventId: string, input: CreateEvaluationPlanInput): Promise<EvaluationPlanWithVersions> {
    const event = await this.client.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new RepositoryError("not-found", "The event was not found.");
    try {
      return await this.client.evaluationPlan.create({
        data: {
          eventId,
          key: stableKey(input.key, "Plan key"),
          versions: {
            create: {
              versionNumber: 1,
              title: requiredText(input.title, "Plan title"),
              description: optionalText(input.description),
            },
          },
        },
        include: lifecycleInclude,
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async createRound(input: CreateEvaluationRoundInput): Promise<EvaluationRound> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const version = await requirePlanVersion(transaction, input.eventId, input.planVersionId);
        requireDraftVersion(version.status);
        const lastRound = await transaction.evaluationRound.findFirst({
          where: { planVersionId: version.id },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        return transaction.evaluationRound.create({
          data: {
            planVersionId: version.id,
            key: stableKey(input.key, "Round key"),
            title: requiredText(input.title, "Round title"),
            description: optionalText(input.description),
            reviewerVisibility: input.reviewerVisibility,
            sortOrder: (lastRound?.sortOrder ?? -1) + 1,
            transitions: { create: { toStatus: "PLANNED" } },
          },
        });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async updateRound(eventId: string, roundId: string, input: UpdateEvaluationRoundInput): Promise<EvaluationRound> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const round = await requireRound(transaction, eventId, roundId);
        requireDraftVersion(round.planVersion.status);
        if (round.status !== "PLANNED") {
          throw new RepositoryError("invalid-input", "Only planned rounds can be edited.");
        }
        return transaction.evaluationRound.update({
          where: { id: round.id },
          data: {
            key: stableKey(input.key, "Round key"),
            title: requiredText(input.title, "Round title"),
            description: optionalText(input.description),
            reviewerVisibility: input.reviewerVisibility,
          },
        });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async reorder(eventId: string, planVersionId: string, orderedIds: readonly string[]): Promise<void> {
    try {
      await this.client.$transaction(async (transaction) => {
        const version = await requirePlanVersion(transaction, eventId, planVersionId);
        requireDraftVersion(version.status);
        const rounds = await transaction.evaluationRound.findMany({
          where: { planVersionId: version.id },
          orderBy: { sortOrder: "asc" },
        });
        if (
          orderedIds.length !== rounds.length ||
          new Set(orderedIds).size !== orderedIds.length ||
          orderedIds.some((id) => !rounds.some((round) => round.id === id))
        ) {
          throw new RepositoryError("invalid-input", "The round order must include every plan-version round once.");
        }
        if (rounds.some(({ status }) => status !== "PLANNED")) {
          throw new RepositoryError("invalid-input", "Only planned rounds can be reordered.");
        }
        const temporaryOffset = 1_000_000 + Math.max(0, ...rounds.map(({ sortOrder }) => sortOrder));
        for (const round of rounds) {
          await transaction.evaluationRound.update({
            where: { id: round.id },
            data: { sortOrder: round.sortOrder + temporaryOffset },
          });
        }
        for (const [sortOrder, id] of orderedIds.entries()) {
          await transaction.evaluationRound.update({ where: { id }, data: { sortOrder } });
        }
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async transition(
    eventId: string,
    roundId: string,
    toStatus: Exclude<EvaluationRoundStatus, "PLANNED">,
    input: { readonly actorId?: string | null; readonly note?: string | null } = {},
  ): Promise<EvaluationRound> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const round = await requireRound(transaction, eventId, roundId);
        if (round.status === toStatus) return round;
        const now = new Date();
        let data: Prisma.EvaluationRoundUpdateInput;

        if (round.status === "PLANNED" && toStatus === "OPEN") {
          if (round.planVersion.status === "RETIRED") {
            throw new RepositoryError("invalid-input", "Retired evaluation plan versions are immutable.");
          }
          const [earlierRounds, anotherOpenRound] = await Promise.all([
            transaction.evaluationRound.findMany({
              where: { planVersionId: round.planVersionId, sortOrder: { lt: round.sortOrder } },
              select: { status: true },
            }),
            transaction.evaluationRound.findFirst({
              where: { planVersionId: round.planVersionId, status: "OPEN", id: { not: round.id } },
              select: { id: true },
            }),
          ]);
          if (earlierRounds.some(({ status }) => status !== "CLOSED" && status !== "ARCHIVED")) {
            throw new RepositoryError("invalid-input", "Close every earlier round before opening this one.");
          }
          if (anotherOpenRound) {
            throw new RepositoryError("invalid-input", "Close the open round before opening another one.");
          }
          if (round.planVersion.status === "DRAFT") {
            await transaction.evaluationPlanVersion.update({
              where: { id: round.planVersionId },
              data: { status: "ACTIVE", activatedAt: now },
            });
          }
          data = { status: "OPEN", visibilitySnapshot: round.reviewerVisibility, opensAt: now };
        } else if (round.status === "OPEN" && toStatus === "CLOSED") {
          const incompleteAssignments = await transaction.evaluationAssignment.count({
            where: {
              roundId: round.id,
              status: { not: "REVOKED" },
              OR: [
                { status: { not: "COMPLETED" } },
                { evaluation: { is: null } },
                { evaluation: { is: { status: { not: "FINAL" } } } },
              ],
            },
          });
          if (incompleteAssignments > 0) {
            throw new RepositoryError("invalid-input", "Complete or withdraw every reviewer assignment first.");
          }
          data = { status: "CLOSED", closesAt: now };
        } else if (round.status === "CLOSED" && toStatus === "ARCHIVED") {
          data = { status: "ARCHIVED", archivedAt: now };
        } else {
          throw new RepositoryError(
            "invalid-input",
            `A ${round.status.toLowerCase()} round cannot transition to ${toStatus.toLowerCase()}.`,
          );
        }

        const updated = await transaction.evaluationRound.update({ where: { id: round.id }, data });
        await transaction.evaluationRoundTransition.create({
          data: {
            roundId: round.id,
            fromStatus: round.status,
            toStatus,
            actorId: optionalText(input.actorId),
            note: optionalText(input.note),
          },
        });

        if (toStatus === "ARCHIVED") {
          const remainingRounds = await transaction.evaluationRound.count({
            where: { planVersionId: round.planVersionId, status: { not: "ARCHIVED" } },
          });
          if (remainingRounds === 0) {
            await transaction.evaluationPlanVersion.update({
              where: { id: round.planVersionId },
              data: { status: "RETIRED", retiredAt: now },
            });
          }
        }

        return updated;
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
