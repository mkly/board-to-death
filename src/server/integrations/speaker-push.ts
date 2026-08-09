import {
  IntegrationProvider,
  IntegrationRemoteRecordStatus,
  IntegrationSyncRecordStatus,
  IntegrationSyncRunStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import type { InfrastructureFailure } from "../infrastructure/index.ts";
import type { AcceleventsAdapter, AcceleventsConnection, AcceleventsSpeakerInput } from "./accelevents.ts";
import { type SpeakerFieldMapping, type SpeakerMappingSource, speakerMappingSources } from "./speaker-mapping.ts";
import {
  assertNoConcurrentSyncRun,
  cancellationRequested,
  cancelSyncRun,
  lockEventSyncRuns,
  retryableRecords,
} from "./sync-run-control.ts";
import { createHash } from "node:crypto";

export interface PushAcceleventsSpeakersInput {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly confirmed: boolean;
  readonly adapter: AcceleventsAdapter;
  readonly connection: AcceleventsConnection;
  readonly retryOfRunId?: string;
}

export interface SpeakerPushRecordResult {
  readonly localId: string;
  readonly remoteId: string | null;
  readonly status: IntegrationSyncRecordStatus;
  readonly errorCode: string | null;
}

export interface SpeakerPushResult {
  readonly runId: string;
  readonly status: IntegrationSyncRunStatus;
  readonly replayed: boolean;
  readonly records: readonly SpeakerPushRecordResult[];
}

interface PushSpeaker {
  readonly id: string;
  readonly profileVersions: readonly {
    readonly email: string;
    readonly givenName: string;
    readonly familyName: string;
    readonly preferredName: string | null;
    readonly organization: string | null;
    readonly jobTitle: string | null;
    readonly consentToPublishProfile: boolean;
  }[];
}

interface PushCandidate {
  readonly localId: string;
  readonly outbound: AcceleventsSpeakerInput | null;
  readonly inputHash: string;
  readonly remoteRecord: {
    readonly id: string;
    readonly remoteId: string;
    readonly comparisonHash: string | null;
    readonly status: IntegrationRemoteRecordStatus;
  } | null;
  readonly initialStatus: IntegrationSyncRecordStatus;
  readonly errorCode: string | null;
  readonly action: "create" | "update" | "skip" | "invalid";
}

const defaultMapping: SpeakerFieldMapping = {
  email: "profile.email",
  firstName: "profile.givenName",
  lastName: "profile.familyName",
};

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new RepositoryError("invalid-input", `${field} is required.`);
  return normalized;
}

function mappingDefinition(value: Prisma.JsonValue | undefined): SpeakerFieldMapping {
  if (!value || Array.isArray(value) || typeof value !== "object") return defaultMapping;
  const definition = value as Record<string, unknown>;
  const isSource = (source: unknown): source is SpeakerMappingSource =>
    typeof source === "string" && speakerMappingSources.some((candidate) => candidate === source);
  return {
    email: isSource(definition.email) ? definition.email : defaultMapping.email,
    firstName: isSource(definition.firstName) ? definition.firstName : defaultMapping.firstName,
    lastName: isSource(definition.lastName) ? definition.lastName : defaultMapping.lastName,
  };
}

function profileValue(profile: PushSpeaker["profileVersions"][number], source: SpeakerMappingSource): string {
  const key = source.slice("profile.".length) as keyof typeof profile;
  const value = profile[key];
  return typeof value === "string" ? value.trim() : "";
}

function outboundSpeaker(speaker: PushSpeaker, mapping: SpeakerFieldMapping): AcceleventsSpeakerInput | null {
  const profile = speaker.profileVersions[0];
  if (!profile) return null;
  return {
    email: profileValue(profile, mapping.email).toLowerCase(),
    firstName: profileValue(profile, mapping.firstName),
    lastName: profileValue(profile, mapping.lastName),
  };
}

function invalidOutbound(outbound: AcceleventsSpeakerInput | null): string | null {
  if (!outbound) return "missing-profile";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(outbound.email)) return "invalid-email";
  if (outbound.firstName === "") return "missing-first-name";
  if (outbound.lastName === "") return "missing-last-name";
  return null;
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function candidateFor(
  speaker: PushSpeaker,
  mapping: SpeakerFieldMapping,
  remoteRecord: PushCandidate["remoteRecord"],
): PushCandidate {
  const profile = speaker.profileVersions[0];
  if (!profile?.consentToPublishProfile) {
    return {
      localId: speaker.id,
      outbound: null,
      inputHash: hashValue({ localId: speaker.id, reason: "publication-consent-required" }),
      remoteRecord,
      initialStatus: IntegrationSyncRecordStatus.SKIPPED,
      errorCode: null,
      action: "skip",
    };
  }
  const outbound = outboundSpeaker(speaker, mapping);
  const invalid = invalidOutbound(outbound);
  if (invalid || !outbound) {
    return {
      localId: speaker.id,
      outbound,
      inputHash: hashValue({ localId: speaker.id, outbound }),
      remoteRecord,
      initialStatus: IntegrationSyncRecordStatus.VALIDATION_FAILED,
      errorCode: invalid ?? "invalid-profile",
      action: "invalid",
    };
  }
  const inputHash = hashValue(outbound);
  if (remoteRecord?.status === IntegrationRemoteRecordStatus.ACTIVE && remoteRecord.comparisonHash === inputHash) {
    return {
      localId: speaker.id,
      outbound,
      inputHash,
      remoteRecord,
      initialStatus: IntegrationSyncRecordStatus.SKIPPED,
      errorCode: null,
      action: "skip",
    };
  }
  const action = remoteRecord?.status === IntegrationRemoteRecordStatus.ACTIVE ? "update" : "create";
  return {
    localId: speaker.id,
    outbound,
    inputHash,
    remoteRecord,
    initialStatus: IntegrationSyncRecordStatus.PENDING,
    errorCode: null,
    action,
  };
}

function failureStatus(failure: InfrastructureFailure): IntegrationSyncRecordStatus {
  if (failure.code === "invalid-input") return IntegrationSyncRecordStatus.VALIDATION_FAILED;
  return failure.retryable ? IntegrationSyncRecordStatus.RETRIABLE_FAILED : IntegrationSyncRecordStatus.TERMINAL_FAILED;
}

function runStatus(records: readonly SpeakerPushRecordResult[]): IntegrationSyncRunStatus {
  const failed = records.filter(
    (record) =>
      record.status === IntegrationSyncRecordStatus.VALIDATION_FAILED ||
      record.status === IntegrationSyncRecordStatus.RETRIABLE_FAILED ||
      record.status === IntegrationSyncRecordStatus.TERMINAL_FAILED,
  ).length;
  if (failed === 0) return IntegrationSyncRunStatus.SUCCEEDED;
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
    readonly records: readonly {
      readonly localId: string;
      readonly remoteId: string | null;
      readonly status: IntegrationSyncRecordStatus;
      readonly errorCode: string | null;
    }[];
  },
  replayed: boolean,
): SpeakerPushResult {
  return {
    runId: run.id,
    status: run.status,
    replayed,
    records: run.records.map((record) => ({
      localId: record.localId,
      remoteId: record.remoteId,
      status: record.status,
      errorCode: record.errorCode,
    })),
  };
}

export class AcceleventsSpeakerPushService {
  readonly #client: PrismaClient;
  readonly #now: () => Date;

  constructor(client: PrismaClient, now: () => Date = () => new Date()) {
    this.#client = client;
    this.#now = now;
  }

  async push(input: PushAcceleventsSpeakersInput): Promise<SpeakerPushResult> {
    const eventId = requiredText(input.eventId, "eventId");
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
    if (!input.confirmed) throw new RepositoryError("invalid-input", "Confirm the Accelevents speaker push first.");

    const state = await this.#client.integrationConfiguration.findFirst({
      where: { eventId, provider: IntegrationProvider.ACCELEVENTS },
      select: {
        id: true,
        versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, remoteEventId: true } },
        fieldMappings: {
          where: { resourceType: "speaker", key: "public-profile" },
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
          where: { resourceType: "speaker" },
          select: { id: true, localId: true, remoteId: true, comparisonHash: true, status: true },
        },
      },
    });
    const configurationVersion = state?.versions[0];
    const mappingVersion = state?.fieldMappings[0]?.versions[0];
    if (!state || !configurationVersion || !mappingVersion) {
      throw new RepositoryError("not-found", "Configure Accelevents and save a speaker mapping before pushing.");
    }
    if (input.connection.remoteEventId !== configurationVersion.remoteEventId) {
      throw new RepositoryError("invalid-input", "The Accelevents connection does not match this event configuration.");
    }

    const speakers = await this.#client.speaker.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        profileVersions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: {
            email: true,
            givenName: true,
            familyName: true,
            preferredName: true,
            organization: true,
            jobTitle: true,
            consentToPublishProfile: true,
          },
        },
      },
    });
    const mapping = mappingDefinition(mappingVersion.definition);
    const remoteByLocalId = new Map(state.remoteRecords.map((record) => [record.localId, record]));
    const retryOfRunId = input.retryOfRunId ? requiredText(input.retryOfRunId, "retryOfRunId") : undefined;
    const retryRecords = retryOfRunId
      ? await retryableRecords(this.#client, {
          eventId,
          configurationId: state.id,
          runId: retryOfRunId,
          resourceType: "speaker",
          now: this.#now(),
        })
      : undefined;
    const candidates = speakers
      .map((speaker) => candidateFor(speaker, mapping, remoteByLocalId.get(speaker.id) ?? null))
      .filter((candidate) => !retryRecords || retryRecords.has(candidate.localId));
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
              const retryRecord = retryRecords?.get(candidate.localId);
              return {
                resourceType: "speaker",
                localId: candidate.localId,
                remoteId: candidate.remoteRecord?.remoteId,
                inputHash: candidate.inputHash,
                retryOfRecordId: retryRecord?.id,
                attemptNumber: retryRecord ? retryRecord.attemptNumber + 1 : 1,
                status: candidate.initialStatus,
                errorCode: candidate.errorCode,
                redactedRequestContext: { action: candidate.action, fields: ["email", "firstName", "lastName"] },
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

    const recordsByLocalId = new Map(run.records.map((record) => [record.localId, record]));
    for (const candidate of candidates) {
      if (candidate.initialStatus !== IntegrationSyncRecordStatus.PENDING || !candidate.outbound) continue;
      if (await cancellationRequested(this.#client, eventId, run.id)) {
        const completedAt = this.#now();
        await cancelSyncRun(this.#client, eventId, run.id, completedAt);
        const cancelled = await this.#client.integrationSyncRun.findUniqueOrThrow({
          where: { id: run.id },
          include: { records: { orderBy: [{ startedAt: "asc" }, { localId: "asc" }] } },
        });
        return resultFor(cancelled, false);
      }
      const syncRecord = recordsByLocalId.get(candidate.localId);
      if (!syncRecord) throw new Error(`Missing sync record for speaker ${candidate.localId}.`);

      const remoteResult =
        candidate.action === "update" && candidate.remoteRecord
          ? await input.adapter.updateSpeaker(input.connection, candidate.remoteRecord.remoteId, candidate.outbound)
          : await input.adapter.createSpeaker(input.connection, candidate.outbound);
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
              resourceType: "speaker",
              localId: candidate.localId,
            },
          },
          create: {
            eventId,
            configurationId: state.id,
            mappingVersionId: mappingVersion.id,
            resourceType: "speaker",
            localId: candidate.localId,
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
