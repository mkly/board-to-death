import {
  IntegrationSyncRecordStatus,
  IntegrationSyncRunStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface RetryableSyncRecord {
  readonly id: string;
  readonly localId: string;
  readonly attemptNumber: number;
}

export async function retryableRecords(
  client: PrismaClient,
  input: {
    readonly eventId: string;
    readonly configurationId: string;
    readonly runId: string;
    readonly resourceType: "speaker" | "session";
    readonly now: Date;
  },
): Promise<ReadonlyMap<string, RetryableSyncRecord>> {
  const run = await client.integrationSyncRun.findFirst({
    where: {
      id: input.runId,
      eventId: input.eventId,
      configurationId: input.configurationId,
      status: { in: [IntegrationSyncRunStatus.PARTIALLY_FAILED, IntegrationSyncRunStatus.FAILED] },
    },
    select: {
      records: {
        where: {
          resourceType: input.resourceType,
          status: IntegrationSyncRecordStatus.RETRIABLE_FAILED,
          OR: [{ retryAfter: null }, { retryAfter: { lte: input.now } }],
          retry: null,
        },
        select: { id: true, localId: true, attemptNumber: true },
      },
    },
  });
  if (!run) throw new RepositoryError("not-found", "The requested Accelevents sync run is not retryable.");
  if (run.records.length === 0) {
    throw new RepositoryError("invalid-input", "This Accelevents sync run has no failures eligible for retry yet.");
  }
  return new Map(run.records.map((record) => [record.localId, record]));
}

export async function lockEventSyncRuns(transaction: Prisma.TransactionClient, eventId: string): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`;
}

export async function assertNoConcurrentSyncRun(transaction: Prisma.TransactionClient, eventId: string): Promise<void> {
  const running = await transaction.integrationSyncRun.findFirst({
    where: { eventId, status: IntegrationSyncRunStatus.RUNNING },
    select: { id: true },
  });
  if (running) {
    throw new RepositoryError("conflict", "Another Accelevents sync run is already active for this event.");
  }
}

export async function cancellationRequested(client: PrismaClient, eventId: string, runId: string): Promise<boolean> {
  const run = await client.integrationSyncRun.findFirst({
    where: { id: runId, eventId },
    select: { cancelRequestedAt: true },
  });
  return run?.cancelRequestedAt !== null && run?.cancelRequestedAt !== undefined;
}

export async function cancelSyncRun(client: PrismaClient, eventId: string, runId: string, now: Date): Promise<void> {
  await client.integrationSyncRun.updateMany({
    where: { id: runId, eventId, status: IntegrationSyncRunStatus.RUNNING },
    data: { status: IntegrationSyncRunStatus.CANCELLED, completedAt: now },
  });
}

export class AcceleventsSyncRunService {
  readonly #client: PrismaClient;
  readonly #now: () => Date;

  constructor(client: PrismaClient, now: () => Date = () => new Date()) {
    this.#client = client;
    this.#now = now;
  }

  async requestCancellation(eventId: string, runId: string): Promise<boolean> {
    const result = await this.#client.integrationSyncRun.updateMany({
      where: { id: runId, eventId, status: IntegrationSyncRunStatus.RUNNING, cancelRequestedAt: null },
      data: { cancelRequestedAt: this.#now() },
    });
    return result.count === 1;
  }

  async get(eventId: string, runId: string) {
    const run = await this.#client.integrationSyncRun.findFirst({
      where: { id: runId, eventId },
      include: { records: { orderBy: [{ startedAt: "asc" }, { localId: "asc" }] } },
    });
    if (!run) throw new RepositoryError("not-found", "The Accelevents sync run was not found for this event.");
    return run;
  }
}
