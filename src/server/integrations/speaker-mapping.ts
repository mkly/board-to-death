import {
  IntegrationProvider,
  IntegrationRemoteRecordStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import type {
  AcceleventsAdapter,
  AcceleventsConnection,
  AcceleventsSpeaker,
  AcceleventsSpeakerInput,
} from "./accelevents.ts";
import { createHash } from "node:crypto";

export const speakerMappingSources = [
  "profile.email",
  "profile.givenName",
  "profile.familyName",
  "profile.preferredName",
  "profile.organization",
  "profile.jobTitle",
] as const;

export type SpeakerMappingSource = (typeof speakerMappingSources)[number];

export interface SpeakerFieldMapping {
  readonly email: SpeakerMappingSource;
  readonly firstName: SpeakerMappingSource;
  readonly lastName: SpeakerMappingSource;
}

export type SpeakerPreviewAction = "create" | "update" | "unchanged" | "skipped" | "invalid";

export interface SpeakerPreviewItem {
  readonly localId: string;
  readonly displayName: string;
  readonly remoteId: string | null;
  readonly action: SpeakerPreviewAction;
  readonly outbound: AcceleventsSpeakerInput | null;
  readonly explanation: string;
}

export interface SpeakerPreview {
  readonly connection: "connected" | "offline" | "disconnected";
  readonly connectionMessage: string;
  readonly mapping: SpeakerFieldMapping;
  readonly mappingVersionNumber: number;
  readonly items: readonly SpeakerPreviewItem[];
  readonly counts: Readonly<Record<SpeakerPreviewAction, number>>;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly total: number;
}

interface StoredSpeaker {
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

interface PreviewState {
  readonly mapping: SpeakerFieldMapping;
  readonly mappingVersionNumber: number;
  readonly speakers: readonly StoredSpeaker[];
  readonly remoteRecords: readonly {
    readonly localId: string;
    readonly remoteId: string;
    readonly comparisonHash: string | null;
  }[];
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

function profileValue(profile: StoredSpeaker["profileVersions"][number], source: SpeakerMappingSource): string {
  const key = source.slice("profile.".length) as keyof typeof profile;
  const value = profile[key];
  return typeof value === "string" ? value.trim() : "";
}

function outboundSpeaker(speaker: StoredSpeaker, mapping: SpeakerFieldMapping): AcceleventsSpeakerInput | null {
  const profile = speaker.profileVersions[0];
  if (!profile) return null;
  return {
    email: profileValue(profile, mapping.email).toLowerCase(),
    firstName: profileValue(profile, mapping.firstName),
    lastName: profileValue(profile, mapping.lastName),
  };
}

function invalidOutbound(outbound: AcceleventsSpeakerInput | null): string | null {
  if (!outbound) return "The speaker has no current profile.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(outbound.email)) return "The mapped email is missing or invalid.";
  if (outbound.firstName === "") return "The mapped first name is missing.";
  if (outbound.lastName === "") return "The mapped last name is missing.";
  return null;
}

function comparisonHash(outbound: AcceleventsSpeakerInput): string {
  return createHash("sha256").update(JSON.stringify(outbound)).digest("hex");
}

function sameSpeaker(remote: AcceleventsSpeaker, outbound: AcceleventsSpeakerInput): boolean {
  return (
    remote.email.trim().toLowerCase() === outbound.email &&
    remote.firstName.trim() === outbound.firstName &&
    remote.lastName.trim() === outbound.lastName
  );
}

function emptyCounts(): Record<SpeakerPreviewAction, number> {
  return { create: 0, update: 0, unchanged: 0, skipped: 0, invalid: 0 };
}

function paginate(
  items: readonly SpeakerPreviewItem[],
  mapping: SpeakerFieldMapping,
  mappingVersionNumber: number,
  page: number,
  pageSize: number,
  connection: SpeakerPreview["connection"],
  connectionMessage: string,
): SpeakerPreview {
  const counts = emptyCounts();
  for (const item of items) counts[item.action] += 1;
  const safePageSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 10;
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Number.isInteger(page) ? Math.min(Math.max(page, 1), pageCount) : 1;
  const start = (safePage - 1) * safePageSize;
  return {
    connection,
    connectionMessage,
    mapping,
    mappingVersionNumber,
    items: items.slice(start, start + safePageSize),
    counts,
    page: safePage,
    pageSize: safePageSize,
    pageCount,
    total: items.length,
  };
}

function disconnectedPreview(state: PreviewState, page: number, pageSize: number, message: string): SpeakerPreview {
  return paginate([], state.mapping, state.mappingVersionNumber, page, pageSize, "disconnected", message);
}

export class SpeakerMappingRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async get(
    eventId: string,
  ): Promise<{ readonly mapping: SpeakerFieldMapping; readonly versionNumber: number } | null> {
    const state = await this.loadState(eventId);
    return state ? { mapping: state.mapping, versionNumber: state.mappingVersionNumber } : null;
  }

  async save(eventId: string, mapping: SpeakerFieldMapping): Promise<number> {
    const validated = mappingDefinition(mapping as unknown as Prisma.JsonValue);
    return this.#client.$transaction(async (transaction) => {
      const configuration = await transaction.integrationConfiguration.findFirst({
        where: { eventId, provider: IntegrationProvider.ACCELEVENTS },
        select: { id: true },
      });
      if (!configuration) throw new RepositoryError("not-found", "Configure Accelevents before saving a mapping.");
      const fieldMapping = await transaction.integrationFieldMapping.upsert({
        where: {
          configurationId_resourceType_key: {
            configurationId: configuration.id,
            resourceType: "speaker",
            key: "public-profile",
          },
        },
        create: {
          eventId,
          configurationId: configuration.id,
          resourceType: "speaker",
          key: "public-profile",
        },
        update: {},
        select: { id: true },
      });
      const latest = await transaction.integrationFieldMappingVersion.findFirst({
        where: { mappingId: fieldMapping.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      await transaction.integrationFieldMappingVersion.create({
        data: {
          eventId,
          configurationId: configuration.id,
          mappingId: fieldMapping.id,
          versionNumber,
          definition: {
            email: validated.email,
            firstName: validated.firstName,
            lastName: validated.lastName,
          },
        },
      });
      return versionNumber;
    });
  }

  async previewOffline(eventId: string, page = 1, pageSize = 10): Promise<SpeakerPreview | null> {
    const state = await this.loadState(eventId);
    if (!state) return null;
    const remoteByLocalId = new Map(state.remoteRecords.map((record) => [record.localId, record]));
    const items = state.speakers.map((speaker): SpeakerPreviewItem => {
      const profile = speaker.profileVersions[0];
      const displayName = profile
        ? `${profile.preferredName ?? profile.givenName} ${profile.familyName}`
        : "Unknown speaker";
      const record = remoteByLocalId.get(speaker.id);
      if (!profile?.consentToPublishProfile) {
        return {
          localId: speaker.id,
          displayName,
          remoteId: record?.remoteId ?? null,
          action: "skipped",
          outbound: null,
          explanation: "Skipped because this profile is not authorized for publication.",
        };
      }
      const outbound = outboundSpeaker(speaker, state.mapping);
      const invalid = invalidOutbound(outbound);
      if (invalid || !outbound) {
        return {
          localId: speaker.id,
          displayName,
          remoteId: record?.remoteId ?? null,
          action: "invalid",
          outbound,
          explanation: invalid ?? "The mapped profile is invalid.",
        };
      }
      if (!record) {
        return {
          localId: speaker.id,
          displayName,
          remoteId: null,
          action: "create",
          outbound,
          explanation: "No event-owned Accelevents link exists; a push would create this speaker.",
        };
      }
      const unchanged = record.comparisonHash === comparisonHash(outbound);
      return {
        localId: speaker.id,
        displayName,
        remoteId: record.remoteId,
        action: unchanged ? "unchanged" : "update",
        outbound,
        explanation: unchanged
          ? "The mapped public profile matches the last successful push."
          : "The mapped public profile changed since the last successful push.",
      };
    });
    return paginate(
      items,
      state.mapping,
      state.mappingVersionNumber,
      page,
      pageSize,
      "offline",
      "Provider contact is deferred until push. Linked records are compared with the last successful outbound hash.",
    );
  }

  async preview(
    eventId: string,
    adapter: AcceleventsAdapter,
    connection: AcceleventsConnection,
    page = 1,
    pageSize = 10,
  ): Promise<SpeakerPreview | null> {
    const state = await this.loadState(eventId);
    if (!state) return null;
    const credentialCheck = await adapter.checkCredentials(connection);
    if (!credentialCheck.ok) {
      return disconnectedPreview(
        state,
        page,
        pageSize,
        "Accelevents is disconnected. Check the event and credentials.",
      );
    }

    const remoteSpeakers = new Map<string, AcceleventsSpeaker>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await adapter.listSpeakers(connection, { cursor, limit: 100 });
      if (!result.ok) {
        return disconnectedPreview(state, page, pageSize, "Accelevents could not return speakers for this preview.");
      }
      for (const speaker of result.value.items) remoteSpeakers.set(speaker.remoteId, speaker);
      const next = result.value.nextCursor;
      if (!next) break;
      if (seenCursors.has(next)) {
        return disconnectedPreview(state, page, pageSize, "Accelevents returned an invalid pagination cursor.");
      }
      seenCursors.add(next);
      cursor = next;
    } while (cursor);

    const remoteByLocalId = new Map(state.remoteRecords.map((record) => [record.localId, record]));
    const items = state.speakers.map((speaker): SpeakerPreviewItem => {
      const profile = speaker.profileVersions[0];
      const displayName = profile
        ? `${profile.preferredName ?? profile.givenName} ${profile.familyName}`
        : "Unknown speaker";
      const record = remoteByLocalId.get(speaker.id);
      if (!profile?.consentToPublishProfile) {
        return {
          localId: speaker.id,
          displayName,
          remoteId: record?.remoteId ?? null,
          action: "skipped",
          outbound: null,
          explanation: "Skipped because this profile is not authorized for publication.",
        };
      }
      const outbound = outboundSpeaker(speaker, state.mapping);
      const invalid = invalidOutbound(outbound);
      if (invalid || !outbound) {
        return {
          localId: speaker.id,
          displayName,
          remoteId: record?.remoteId ?? null,
          action: "invalid",
          outbound,
          explanation: invalid ?? "The mapped profile is invalid.",
        };
      }
      if (!record) {
        return {
          localId: speaker.id,
          displayName,
          remoteId: null,
          action: "create",
          outbound,
          explanation: "No event-owned Accelevents link exists; a push would create this speaker.",
        };
      }
      const remote = remoteSpeakers.get(record.remoteId);
      if (!remote) {
        return {
          localId: speaker.id,
          displayName,
          remoteId: record.remoteId,
          action: "invalid",
          outbound,
          explanation: "The linked Accelevents speaker was not found in the configured remote event.",
        };
      }
      const unchanged = sameSpeaker(remote, outbound);
      return {
        localId: speaker.id,
        displayName,
        remoteId: remote.remoteId,
        action: unchanged ? "unchanged" : "update",
        outbound,
        explanation: unchanged
          ? "The mapped public profile already matches Accelevents."
          : "The mapped public profile differs from Accelevents and would be updated.",
      };
    });
    return paginate(
      items,
      state.mapping,
      state.mappingVersionNumber,
      page,
      pageSize,
      "connected",
      `Connected to Accelevents event ${credentialCheck.value.remoteEventId}.`,
    );
  }

  async authorizedCsv(eventId: string): Promise<string | null> {
    const state = await this.loadState(eventId);
    if (!state) return null;
    const rows = state.speakers.flatMap((speaker) => {
      const profile = speaker.profileVersions[0];
      if (!profile?.consentToPublishProfile) return [];
      const outbound = outboundSpeaker(speaker, state.mapping);
      if (!outbound || invalidOutbound(outbound)) return [];
      return [[speaker.id, outbound.email, outbound.firstName, outbound.lastName]];
    });
    return [["localId", "email", "firstName", "lastName"], ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
      .concat("\r\n");
  }

  private async loadState(eventId: string): Promise<PreviewState | null> {
    requiredText(eventId, "eventId");
    const configuration = await this.#client.integrationConfiguration.findFirst({
      where: { eventId, provider: IntegrationProvider.ACCELEVENTS },
      select: {
        id: true,
        fieldMappings: {
          where: { resourceType: "speaker", key: "public-profile" },
          take: 1,
          select: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { versionNumber: true, definition: true },
            },
          },
        },
        remoteRecords: {
          where: { resourceType: "speaker", status: IntegrationRemoteRecordStatus.ACTIVE },
          select: { localId: true, remoteId: true, comparisonHash: true },
        },
      },
    });
    if (!configuration) return null;
    const mappingVersion = configuration.fieldMappings[0]?.versions[0];
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
    return {
      mapping: mappingDefinition(mappingVersion?.definition),
      mappingVersionNumber: mappingVersion?.versionNumber ?? 0,
      speakers,
      remoteRecords: configuration.remoteRecords,
    };
  }
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
