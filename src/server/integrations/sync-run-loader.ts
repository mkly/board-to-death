import "server-only";

import {
  IntegrationSyncRecordStatus,
  IntegrationSyncRunStatus,
  type PrismaClient,
} from "../../generated/prisma/client.ts";

export type SyncRunResourceType = "speaker" | "session";

export interface SyncRunRecordSummary {
  readonly id: string;
  readonly resourceType: string;
  readonly localId: string;
  readonly remoteId: string | null;
  readonly status: IntegrationSyncRecordStatus;
  readonly errorCode: string | null;
  readonly explanation: string | null;
  readonly attemptNumber: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly retryAfter: Date | null;
  readonly retryEligible: boolean;
  readonly alreadyRetried: boolean;
}

export interface SyncRunSummary {
  readonly id: string;
  readonly status: IntegrationSyncRunStatus;
  readonly resourceType: SyncRunResourceType | null;
  readonly retryOfRunId: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly records: readonly SyncRunRecordSummary[];
  readonly retryEligibleCount: number;
  readonly retryable: boolean;
  readonly cancellable: boolean;
}

const FAILURE_EXPLANATIONS: Readonly<Record<string, string>> = {
  "invalid-input": "The service rejected the request.",
  unauthorized: "The service rejected its credentials.",
  "not-found": "The requested resource was not found.",
  conflict: "The request conflicts with the current service state.",
  "rate-limited": "The service rate limit was reached.",
  timeout: "The service request timed out.",
  unavailable: "The service is temporarily unavailable.",
  unexpected: "The service request failed unexpectedly.",
  "missing-profile": "The speaker has no publishable profile.",
  "invalid-email": "The speaker's email address is invalid.",
  "missing-first-name": "The speaker is missing a first name.",
  "missing-last-name": "The speaker is missing a last name.",
  "invalid-profile": "The speaker profile does not meet Accelevents requirements.",
};

function explanationFor(errorCode: string | null): string | null {
  if (!errorCode) return null;
  return FAILURE_EXPLANATIONS[errorCode] ?? errorCode;
}

export async function loadAcceleventsSyncHistory(
  client: PrismaClient,
  eventId: string,
): Promise<readonly SyncRunSummary[]> {
  const runs = await client.integrationSyncRun.findMany({
    where: { eventId },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    include: {
      records: {
        orderBy: [{ startedAt: "asc" }, { localId: "asc" }],
        include: { retry: { select: { id: true } } },
      },
    },
  });
  const now = new Date();

  return runs.map((run) => {
    const records: SyncRunRecordSummary[] = run.records.map((record) => {
      const alreadyRetried = record.retry !== null;
      const retryEligible =
        !alreadyRetried &&
        record.status === IntegrationSyncRecordStatus.RETRIABLE_FAILED &&
        (record.retryAfter === null || record.retryAfter <= now);
      return {
        id: record.id,
        resourceType: record.resourceType,
        localId: record.localId,
        remoteId: record.remoteId,
        status: record.status,
        errorCode: record.errorCode,
        explanation: explanationFor(record.errorCode),
        attemptNumber: record.attemptNumber,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        retryAfter: record.retryAfter,
        retryEligible,
        alreadyRetried,
      };
    });
    const resourceType = (run.records[0]?.resourceType ?? null) as SyncRunResourceType | null;
    const retryEligibleCount = records.filter((record) => record.retryEligible).length;
    const retryable =
      resourceType !== null &&
      retryEligibleCount > 0 &&
      (run.status === IntegrationSyncRunStatus.PARTIALLY_FAILED || run.status === IntegrationSyncRunStatus.FAILED);
    const cancellable = run.status === IntegrationSyncRunStatus.RUNNING && run.cancelRequestedAt === null;

    return {
      id: run.id,
      status: run.status,
      resourceType,
      retryOfRunId: run.retryOfRunId,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      cancelRequestedAt: run.cancelRequestedAt,
      records,
      retryEligibleCount,
      retryable,
      cancellable,
    };
  });
}
