import "server-only";

import {
  IntegrationRemoteRecordStatus,
  type PrismaClient,
  PublishedProgramState,
} from "../../generated/prisma/client.ts";
import { PublishedProgramRepository } from "../published-program/repositories.ts";
import type { AcceleventsAdapter } from "./accelevents.ts";
import { DeterministicAcceleventsAdapter } from "./accelevents.ts";
import { AcceleventsConfigurationRepository } from "./configuration.ts";
import {
  AcceleventsSessionMappingRepository,
  buildSessionOutboundRecords,
  DEFAULT_SESSION_MAPPING,
  previewAcceleventsSessions,
  type SessionMappingDefinition,
  type SessionPreviewResult,
  type SessionRemoteRecord,
} from "./session-preview.ts";

export interface LoadedSessionPreview {
  readonly configuration: Awaited<ReturnType<AcceleventsConfigurationRepository["get"]>>;
  readonly mapping: SessionMappingDefinition;
  readonly mappingVersion: number | null;
  readonly preview: SessionPreviewResult | null;
  readonly publishedVersion: number | null;
}

export interface LoadedSessionPreviewCsv {
  readonly configured: boolean;
  readonly publishedVersion: number | null;
  readonly records: ReturnType<typeof buildSessionOutboundRecords>;
}

export async function loadSessionPreviewCsv(client: PrismaClient, eventId: string): Promise<LoadedSessionPreviewCsv> {
  const [configuration, storedMapping, published] = await Promise.all([
    new AcceleventsConfigurationRepository(client).get(eventId),
    new AcceleventsSessionMappingRepository(client).get(eventId),
    new PublishedProgramRepository(client).latest(eventId),
  ]);
  if (!configuration || published?.state !== PublishedProgramState.PUBLISHED || !published.snapshot) {
    return { configured: Boolean(configuration), publishedVersion: published?.versionNumber ?? null, records: [] };
  }
  const remoteRecords = await client.integrationRemoteRecord.findMany({
    where: { eventId, configurationId: configuration.id },
    select: { localId: true, remoteId: true, resourceType: true, status: true },
  });
  return {
    configured: true,
    publishedVersion: published.versionNumber,
    records: buildSessionOutboundRecords(
      eventId,
      published.snapshot,
      storedMapping?.definition ?? DEFAULT_SESSION_MAPPING,
      remoteRecords,
    ),
  };
}

export async function loadSessionPreview(
  client: PrismaClient,
  eventId: string,
  adapterOverride?: AcceleventsAdapter,
): Promise<LoadedSessionPreview> {
  const [configuration, storedMapping, published] = await Promise.all([
    new AcceleventsConfigurationRepository(client).get(eventId),
    new AcceleventsSessionMappingRepository(client).get(eventId),
    new PublishedProgramRepository(client).latest(eventId),
  ]);
  const mapping = storedMapping?.definition ?? DEFAULT_SESSION_MAPPING;
  if (!configuration || published?.state !== PublishedProgramState.PUBLISHED || !published.snapshot) {
    return {
      configuration,
      mapping,
      mappingVersion: storedMapping?.versionNumber ?? null,
      preview: null,
      publishedVersion: published?.versionNumber ?? null,
    };
  }

  const remoteRecords: SessionRemoteRecord[] = await client.integrationRemoteRecord.findMany({
    where: { eventId, configurationId: configuration.id },
    select: { localId: true, remoteId: true, resourceType: true, status: true },
  });
  const activeSpeakerLinks = remoteRecords.filter(
    (record) => record.resourceType === "speaker" && record.status === IntegrationRemoteRecordStatus.ACTIVE,
  );
  const activeSessionLinks = remoteRecords.filter(
    (record) => record.resourceType === "session" && record.status === IntegrationRemoteRecordStatus.ACTIVE,
  );
  const runtimeKey = "runtime-preview-key";
  const adapter =
    adapterOverride ??
    new DeterministicAcceleventsAdapter({
      remoteEventId: configuration.remoteEventId,
      apiKey: runtimeKey,
      pageSize: 2,
      speakers: activeSpeakerLinks.map((record, index) => ({
        remoteId: record.remoteId,
        email: `linked-${index}@preview.invalid`,
        firstName: "Linked",
        lastName: "Speaker",
      })),
      sessions: activeSessionLinks.map((record) => ({
        remoteId: record.remoteId,
        title: "Remote session awaiting comparison",
        description: "",
        speakerRemoteIds: [],
      })),
    });
  const preview = await previewAcceleventsSessions({
    eventId,
    remoteEventId: configuration.remoteEventId,
    snapshot: published.snapshot,
    mapping,
    remoteRecords,
    connection: { remoteEventId: configuration.remoteEventId, apiKey: runtimeKey },
    adapter,
  });

  return {
    configuration,
    mapping,
    mappingVersion: storedMapping?.versionNumber ?? null,
    preview,
    publishedVersion: published.versionNumber,
  };
}
