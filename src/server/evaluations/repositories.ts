import type {
  EvaluationPlan,
  EvaluationRound,
  EvaluationRoundStatus,
  Prisma,
  PrismaClient,
  ReviewerVisibility,
} from "../../generated/prisma/client.ts";

export type EvaluationRepositoryErrorCode = "conflict" | "invalid-input" | "not-found";

export class EvaluationRepositoryError extends Error {
  readonly code: EvaluationRepositoryErrorCode;

  constructor(code: EvaluationRepositoryErrorCode, message: string) {
    super(message);
    this.name = "EvaluationRepositoryError";
    this.code = code;
  }
}

export type EvaluationPlanWithRounds = Prisma.EvaluationPlanGetPayload<{
  include: { rounds: { include: { transitions: true } } };
}>;

export interface CreateEvaluationRoundInput {
  readonly eventId: string;
  readonly planId: string;
  readonly name: string;
  readonly reviewerVisibility: ReviewerVisibility;
}

export interface UpdateEvaluationRoundInput {
  readonly name: string;
  readonly reviewerVisibility: ReviewerVisibility;
}

function invalid(message: string): never {
  throw new EvaluationRepositoryError("invalid-input", message);
}

function requireName(value: string): string {
  const name = value.trim();
  if (name === "") {
    invalid("A name is required.");
  }
  return name;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof EvaluationRepositoryError) {
    throw error;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new EvaluationRepositoryError("conflict", "The evaluation plan changed. Reload and try again.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new EvaluationRepositoryError("not-found", "The event-owned evaluation record was not found.");
    }
  }
  throw error;
}

async function requirePlan(
  client: PrismaClient | Prisma.TransactionClient,
  eventId: string,
  planId: string,
): Promise<EvaluationPlan> {
  const plan = await client.evaluationPlan.findFirst({ where: { eventId, id: planId } });
  if (!plan) {
    throw new EvaluationRepositoryError("not-found", "The event-owned evaluation plan was not found.");
  }
  return plan;
}

async function requireRound(
  client: PrismaClient | Prisma.TransactionClient,
  eventId: string,
  roundId: string,
): Promise<EvaluationRound> {
  const round = await client.evaluationRound.findFirst({ where: { eventId, id: roundId } });
  if (!round) {
    throw new EvaluationRepositoryError("not-found", "The event-owned evaluation round was not found.");
  }
  return round;
}

export class EvaluationPlanRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async get(eventId: string): Promise<EvaluationPlanWithRounds | null> {
    return this.client.evaluationPlan.findUnique({
      where: { eventId },
      include: {
        rounds: {
          orderBy: { sortOrder: "asc" },
          include: { transitions: { orderBy: { occurredAt: "asc" } } },
        },
      },
    });
  }

  async create(eventId: string, name: string): Promise<EvaluationPlan> {
    const event = await this.client.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) {
      throw new EvaluationRepositoryError("not-found", "The event was not found.");
    }
    try {
      return await this.client.evaluationPlan.create({ data: { eventId, name: requireName(name) } });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async createRound(input: CreateEvaluationRoundInput): Promise<EvaluationRound> {
    try {
      return await this.client.$transaction(async (transaction) => {
        await requirePlan(transaction, input.eventId, input.planId);
        const lastRound = await transaction.evaluationRound.findFirst({
          where: { eventId: input.eventId, planId: input.planId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        return transaction.evaluationRound.create({
          data: {
            eventId: input.eventId,
            planId: input.planId,
            name: requireName(input.name),
            reviewerVisibility: input.reviewerVisibility,
            sortOrder: (lastRound?.sortOrder ?? -1) + 1,
            transitions: { create: { toStatus: "DRAFT" } },
          },
        });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async updateRound(
    eventId: string,
    roundId: string,
    input: UpdateEvaluationRoundInput,
  ): Promise<EvaluationRound> {
    const result = await this.client.evaluationRound.updateMany({
      where: { eventId, id: roundId, status: "DRAFT" },
      data: { name: requireName(input.name), reviewerVisibility: input.reviewerVisibility },
    });
    if (result.count === 0) {
      await requireRound(this.client, eventId, roundId);
      invalid("Only draft rounds can be edited.");
    }
    return requireRound(this.client, eventId, roundId);
  }

  async reorder(eventId: string, planId: string, orderedIds: readonly string[]): Promise<EvaluationRound[]> {
    try {
      return await this.client.$transaction(async (transaction) => {
        await requirePlan(transaction, eventId, planId);
        const rounds = await transaction.evaluationRound.findMany({
          where: { eventId, planId },
          orderBy: { sortOrder: "asc" },
        });
        if (new Set(orderedIds).size !== orderedIds.length || orderedIds.length !== rounds.length) {
          invalid("The round order is incomplete.");
        }
        const currentIds = new Set(rounds.map(({ id }) => id));
        if (orderedIds.some((id) => !currentIds.has(id))) {
          invalid("The round order includes a round from another plan.");
        }
        for (const [index, round] of rounds.entries()) {
          if (round.status !== "DRAFT" && orderedIds[index] !== round.id) {
            invalid("Active, closed, and archived rounds cannot be reordered.");
          }
        }
        const draftIds = rounds.filter(({ status }) => status === "DRAFT").map(({ id }) => id);
        for (const [index, id] of draftIds.entries()) {
          await transaction.evaluationRound.update({ where: { id }, data: { sortOrder: 1_000_000 + index } });
        }
        for (const [index, id] of orderedIds.entries()) {
          if (draftIds.includes(id)) {
            await transaction.evaluationRound.update({ where: { id }, data: { sortOrder: index } });
          }
        }
        return transaction.evaluationRound.findMany({
          where: { eventId, planId },
          orderBy: { sortOrder: "asc" },
        });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async transition(
    eventId: string,
    roundId: string,
    toStatus: Exclude<EvaluationRoundStatus, "DRAFT">,
  ): Promise<EvaluationRound> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const round = await requireRound(transaction, eventId, roundId);
        const now = new Date();
        let data: Prisma.EvaluationRoundUpdateInput;

        if (round.status === "DRAFT" && toStatus === "ACTIVE") {
          const earlierRounds = await transaction.evaluationRound.findMany({
            where: { planId: round.planId, sortOrder: { lt: round.sortOrder } },
            select: { status: true },
          });
          if (earlierRounds.some(({ status }) => status !== "CLOSED" && status !== "ARCHIVED")) {
            invalid("Close every earlier round before activating this one.");
          }
          data = {
            status: "ACTIVE",
            visibilitySnapshot: round.reviewerVisibility,
            activatedAt: now,
          };
        } else if (round.status === "ACTIVE" && toStatus === "CLOSED") {
          data = { status: "CLOSED", closedAt: now };
        } else if (round.status === "CLOSED" && toStatus === "ARCHIVED") {
          data = { status: "ARCHIVED", archivedAt: now };
        } else {
          invalid(`A ${round.status.toLowerCase()} round cannot transition to ${toStatus.toLowerCase()}.`);
        }

        const updated = await transaction.evaluationRound.update({ where: { id: round.id }, data });
        await transaction.evaluationRoundTransition.create({
          data: { roundId: round.id, fromStatus: round.status, toStatus },
        });
        return updated;
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
