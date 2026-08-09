import {
  IntegrationProvider,
  IntegrationRemoteRecordStatus,
  IntegrationSyncRecordStatus,
  IntegrationSyncRunStatus,
  type PrismaClient,
  PublishedProgramState,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import type { InfrastructureFailure } from "../infrastructure/index.ts";
import type { AcceleventsAdapter, AcceleventsConnection, AcceleventsSessionInput } from "./accelevents.ts";
import {
  buildSessionOutboundRecords,
  parseSessionMappingDefinition,
  type SessionPreviewRecord,
  type SessionRemoteRecord,
  toAcceleventsSessionInput,
} from "./session-preview.ts";
import {
  AcceleventsSpeakerPushService,
  type PushAcceleventsSpeakersInput,
  type SpeakerPushResult,
} from "./speaker-push.ts";
import {
  assertNoConcurrentSyncRun,
  cancellationRequested,
  cancelSyncRun,
  lockEventSyncRuns,
  retryableRecords,
} from "./sync-run-control.ts";
import { createHash } from "node:crypto";

export interface PushAcceleventsSessionsInput {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly confirmed: boolean;
  readonly adapter: AcceleventsAdapter;
  readonly connection: AcceleventsConnection;
  readonly retryOfRunId?: string;
}

export interface SessionPushRecordResult {
  readonly localId: string;
  readonly remoteId: string | null;
  readonly status: IntegrationSyncRecordStatus;
  readonly errorCode: string | null;
}

export interface SessionPushResult {
  readonly runId: string;
  readonly status: IntegrationSyncRunStatus;
  readonly replayed: boolean;
  readonly records: readonly SessionPushRecordResult[];
}

export interface ProgramPushResult {
  readonly speakers: SpeakerPushResult;
  readonly sessions: SessionPushResult;
}

interface SessionCandidate {
  readonly record: SessionPreviewRecord;
  readonly outbound: AcceleventsSessionInput;
  readonly inputHash: string;
  readonly action: "create" | "update" | "skip" | "invalid";
  readonly initialStatus: IntegrationSyncRecordStatus;
  readonly errorCode: string | null;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new RepositoryError("invalid-input", `${field} is required.`);
  return normalized;
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function failureStatus(failure: InfrastructureFailure): IntegrationSyncRecordStatus {
  if (failure.code === "invalid-input") return IntegrationSyncRecordStatus.VALIDATION_FAILED;
  return failure.retryable ? IntegrationSyncRecordStatus.RETRIABLE_FAILED : IntegrationSyncRecordStatus.TERMINAL_FAILED;
}

function runStatus(records: readonly SessionPushRecordResult[]): IntegrationSyncRunStatus {
  const failed = records.some(
    (record) =>
      record.status === IntegrationSyncRecordStatus.VALIDATION_FAILED ||
      record.status === IntegrationSyncRecordStatus.RETRIABLE_FAILED ||
      record.status === IntegrationSyncRecordStatus.TERMINAL_FAILED,
  );
  if (!failed) return IntegrationSyncRunStatus.SUCCEEDED;
  const succeeded = records.some(
    (record) =>
      record.status === IntegrationSyncRecordStatus.SUCCEEDED || record.status === IntegrationSyncRecordStatus.SKIPPED,
  );
  return succeeded ? IntegrationSyncRunStatus.PARTIALLY_FAILED : IntegrationSyncRunStatus.FAILED;
}

function resultFor(
  run: {
    readonly id: string;
    readonly status: IntegrationSyncRunStatus;
    readonly records: readonly SessionPushRecordResult[];
  },
  replayed: boolean,
): SessionPushResult {
  return {
    runId: run.id,
    status: run.status,
    replayed,
    records: run.records.map(({ localId, remoteId, status, errorCode }) => ({
      localId,
      remoteId,
      status,
      errorCode,
    })),
  };
}

function candidateFor(record: SessionPreviewRecord, comparisonHash: string | null): SessionCandidate {
  const outbound = toAcceleventsSessionInput(record);
  const inputHash = hashValue(outbound);
  if (record.action === "invalid" || record.action === "skipped") {
    return {
      record,
      outbound,
      inputHash,
      action: "invalid",
      initialStatus: IntegrationSyncRecordStatus.VALIDATION_FAILED,
      errorCode: record.explanations[0] ?? "invalid-session",
    };
  }
  if (record.remoteId && comparisonHash === inputHash) {
    return {
      record,
      outbound,
      inputHash,
      action: "skip",
      initialStatus: IntegrationSyncRecordStatus.SKIPPED,
      errorCode: null,
    };
  }
  return {
    record,
    outbound,
    inputHash,
    action: record.remoteId ? "update" : "create",
    initialStatus: IntegrationSyncRecordStatus.PENDING,
    errorCode: null,
  };
}

export class AcceleventsSessionPushService {
  readonly #client: PrismaClient;
  readonly #now: () => Date;

  constructor(client: PrismaClient, now: () => Date = () => new Date()) {
    this.#client = client;
    this.#now = now;
  }

  async push(input: PushAcceleventsSessionsInput): Promise<SessionPushResult> {
    const eventId = requiredText(input.eventId, "eventId");
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
    if (!input.confirmed) throw new RepositoryError("invalid-input", "Confirm the Accelevents session push first.");

    const state = await this.#client.integrationConfiguration.findFirst({
      where: { eventId, provider: IntegrationProvider.ACCELEVENTS },
      select: {
        id: true,
        versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, remoteEventId: true } },
        fieldMappings: {
          where: { resourceType: "session", key: "outbound-session" },
          take: 1,
          select: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { id: true, definition: true },
            },
          },
        },
        remoteRecords: {
          where: { resourceType: { in: ["speaker", "session"] } },
          select: {
            localId: true,
            remoteId: true,
            resourceType: true,
            status: true,
            comparisonHash: true,
          },
        },
      },
    });
    const configurationVersion = state?.versions[0];
    const mappingVersion = state?.fieldMappings[0]?.versions[0];
    if (!state || !configurationVersion || !mappingVersion) {
      throw new RepositoryError("not-found", "Configure Accelevents and save a session mapping before pushing.");
    }
    if (input.connection.remoteEventId !== configurationVersion.remoteEventId) {
      throw new RepositoryError("invalid-input", "The Accelevents connection does not match this event configuration.");
    }

    const replayed = await this.#client.integrationSyncRun.findUnique({
      where: { configurationId_idempotencyKey: { configurationId: state.id, idempotencyKey } },
      include: { records: { orderBy: [{ startedAt: "asc" }, { localId: "asc" }] } },
    });
    if (replayed) return resultFor(replayed, true);

    const published = await this.#client.publishedProgramVersion.findFirst({
      where: { eventId },
      orderBy: { versionNumber: "desc" },
    });
    if (published?.state !== PublishedProgramState.PUBLISHED || !published.snapshot) {
      throw new RepositoryError("not-found", "Publish the program before pushing Accelevents sessions.");
    }
    const remoteRecords = state.remoteRecords as SessionRemoteRecord[];
    const comparisons = new Map(
      state.remoteRecords
        .filter((record) => record.resourceType === "session")
        .map((record) => [record.localId, record.comparisonHash]),
    );
    const records = buildSessionOutboundRecords(
      eventId,
      published.snapshot as never,
      parseSessionMappingDefinition(mappingVersion.definition),
      remoteRecords,
    );
    const retryOfRunId = input.retryOfRunId ? requiredText(input.retryOfRunId, "retryOfRunId") : undefined;
    const retryRecords = retryOfRunId
      ? await retryableRecords(this.#client, {
          eventId,
          configurationId: state.id,
          runId: retryOfRunId,
          resourceType: "session",
          now: this.#now(),
        })
      : undefined;
    const candidates = records
      .map((record) => candidateFor(record, comparisons.get(record.localId) ?? null))
      .filter((candidate) => !retryRecords || retryRecords.has(candidate.record.localId));
    const startedAt = this.#now();
    const created = await this.#client.$transaction(async (transaction) => {
      await lockEventSyncRuns(transaction, eventId);
      const existing = await transaction.integrationSyncRun.findUnique({
        where: { configurationId_idempotencyKey: { configurationId: state.id, idempotencyKey } },
        include: { records: { orderBy: [{ startedAt: "asc" }, { localId: "asc" }] } },
      });
      if (existing) return { replayed: true, run: existing } as const;
      await assertNoConcurrentSyncRun(transaction, eventId);
      const run = await transaction.integrationSyncRun.create({
        data: {
          eventId,
          configurationId: state.id,
          configurationVersionId: configurationVersion.id,
          mappingVersionId: mappingVersion.id,
          retryOfRunId,
          idempotencyKey,
          status: IntegrationSyncRunStatus.RUNNING,
          startedAt,
          records: {
            create: candidates.map((candidate) => {
              const retryRecord = retryRecords?.get(candidate.record.localId);
              return {
                resourceType: "session",
                localId: candidate.record.localId,
                remoteId: candidate.record.remoteId,
                inputHash: candidate.inputHash,
                retryOfRecordId: retryRecord?.id,
                attemptNumber: retryRecord ? retryRecord.attemptNumber + 1 : 1,
                status: candidate.initialStatus,
                errorCode: candidate.errorCode,
                redactedRequestContext: { action: candidate.action, fields: ["title", "description", "speakers"] },
                startedAt,
                completedAt: candidate.initialStatus === IntegrationSyncRecordStatus.PENDING ? undefined : startedAt,
              };
            }),
          },
        },
        include: { records: true },
      });
      return { replayed: false, run } as const;
    });
    if (created.replayed) return resultFor(created.run, true);
    const run = created.run;

    const credential = await input.adapter.checkCredentials(input.connection);
    if (!credential.ok) {
      const completedAt = this.#now();
      const status = failureStatus(credential.error);
      await this.#client.integrationSyncRecord.updateMany({
        where: { runId: run.id, status: IntegrationSyncRecordStatus.PENDING },
        data: {
          status,
          errorCode: credential.error.code,
          retryAfter:
            status === IntegrationSyncRecordStatus.RETRIABLE_FAILED
              ? new Date(completedAt.getTime() + (credential.error.retryAfterMs ?? 0))
              : null,
          completedAt,
        },
      });
      const failed = await this.#client.integrationSyncRun.update({
        where: { id: run.id },
        data: { status: IntegrationSyncRunStatus.FAILED, completedAt },
        include: { records: { orderBy: [{ startedAt: "asc" }, { localId: "asc" }] } },
      });
      return resultFor(failed, false);
    }

    const syncRecords = new Map(run.records.map((record) => [record.localId, record]));
    for (const candidate of candidates) {
      if (candidate.initialStatus !== IntegrationSyncRecordStatus.PENDING) continue;
      if (await cancellationRequested(this.#client, eventId, run.id)) {
        const completedAt = this.#now();
        await cancelSyncRun(this.#client, eventId, run.id, completedAt);
        const cancelled = await this.#client.integrationSyncRun.findUniqueOrThrow({
          where: { id: run.id },
          include: { records: { orderBy: [{ startedAt: "asc" }, { localId: "asc" }] } },
        });
        return resultFor(cancelled, false);
      }
      const syncRecord = syncRecords.get(candidate.record.localId);
      if (!syncRecord) throw new Error(`Missing sync record for session ${candidate.record.localId}.`);
      const remoteResult =
        candidate.action === "update" && candidate.record.remoteId
          ? await input.adapter.updateSession(input.connection, candidate.record.remoteId, candidate.outbound)
          : await input.adapter.createSession(input.connection, candidate.outbound);
      const completedAt = this.#now();
      if (!remoteResult.ok) {
        const status = failureStatus(remoteResult.error);
        await this.#client.integrationSyncRecord.update({
          where: { id: syncRecord.id },
          data: {
            status,
            errorCode: remoteResult.error.code,
            retryAfter:
              status === IntegrationSyncRecordStatus.RETRIABLE_FAILED
                ? new Date(completedAt.getTime() + (remoteResult.error.retryAfterMs ?? 0))
                : null,
            completedAt,
          },
        });
        continue;
      }
      await this.#client.$transaction(async (transaction) => {
        const remoteRecord = await transaction.integrationRemoteRecord.upsert({
          where: {
            configurationId_resourceType_localId: {
              configurationId: state.id,
              resourceType: "session",
              localId: candidate.record.localId,
            },
          },
          create: {
            eventId,
            configurationId: state.id,
            mappingVersionId: mappingVersion.id,
            resourceType: "session",
            localId: candidate.record.localId,
            remoteId: remoteResult.value.remoteId,
            comparisonHash: candidate.inputHash,
            lastSyncedAt: completedAt,
          },
          update: {
            mappingVersionId: mappingVersion.id,
            remoteId: remoteResult.value.remoteId,
            status: IntegrationRemoteRecordStatus.ACTIVE,
            comparisonHash: candidate.inputHash,
            lastSyncedAt: completedAt,
            staleAt: null,
          },
        });
        await transaction.integrationSyncRecord.update({
          where: { id: syncRecord.id },
          data: {
            remoteRecordId: remoteRecord.id,
            remoteId: remoteResult.value.remoteId,
            status: IntegrationSyncRecordStatus.SUCCEEDED,
            errorCode: null,
            completedAt,
          },
        });
      });
    }

    const completedRecords = await this.#client.integrationSyncRecord.findMany({
      where: { runId: run.id },
      orderBy: [{ startedAt: "asc" }, { localId: "asc" }],
      select: { localId: true, remoteId: true, status: true, errorCode: true },
    });
    const status = runStatus(completedRecords);
    const completed = await this.#client.integrationSyncRun.update({
      where: { id: run.id },
      data: { status, completedAt: this.#now() },
      include: { records: { orderBy: [{ startedAt: "asc" }, { localId: "asc" }] } },
    });
    return resultFor(completed, false);
  }
}

export class AcceleventsProgramPushService {
  readonly #speakers: AcceleventsSpeakerPushService;
  readonly #sessions: AcceleventsSessionPushService;

  constructor(client: PrismaClient, now: () => Date = () => new Date()) {
    this.#speakers = new AcceleventsSpeakerPushService(client, now);
    this.#sessions = new AcceleventsSessionPushService(client, now);
  }

  async push(input: PushAcceleventsSpeakersInput): Promise<ProgramPushResult> {
    const key = requiredText(input.idempotencyKey, "idempotencyKey");
    const speakers = await this.#speakers.push({ ...input, idempotencyKey: `${key}:speakers` });
    const sessions = await this.#sessions.push({ ...input, idempotencyKey: `${key}:sessions` });
    return { speakers, sessions };
  }
}
