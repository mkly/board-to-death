import {
  IntegrationProvider,
  IntegrationRemoteRecordStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import type { PublishedProgramSnapshot } from "../published-program/repositories.ts";
import type {
  AcceleventsAdapter,
  AcceleventsConnection,
  AcceleventsPage,
  AcceleventsPageRequest,
  AcceleventsSession,
  AcceleventsSessionInput,
  AcceleventsSpeaker,
} from "./accelevents.ts";

export const DEFAULT_SESSION_MAPPING = {
  title: "session.title",
  description: "session.description",
  speakers: "linked-speakers",
} as const satisfies SessionMappingDefinition;

export interface SessionMappingDefinition {
  readonly title: "session.title" | "event.name";
  readonly description: "session.description" | "event.theme" | "omit";
  readonly speakers: "linked-speakers" | "omit";
}

export interface SessionMappingView {
  readonly id: string;
  readonly configurationId: string;
  readonly versionNumber: number;
  readonly definition: SessionMappingDefinition;
  readonly createdAt: Date;
}

export interface SessionRemoteRecord {
  readonly localId: string;
  readonly remoteId: string;
  readonly resourceType: string;
  readonly status: IntegrationRemoteRecordStatus;
}

export type SessionPreviewAction = "create" | "update" | "unchanged" | "skipped" | "invalid";

export interface SessionPreviewRecord {
  readonly localId: string;
  readonly remoteId: string | null;
  readonly title: string;
  readonly description: string;
  readonly speakerRemoteIds: readonly string[];
  readonly startsAt: string;
  readonly endsAt: string;
  readonly roomName: string;
  readonly trackNames: readonly string[];
  readonly action: SessionPreviewAction;
  readonly explanations: readonly string[];
}

export interface SessionPreviewResult {
  readonly status: "ready" | "disconnected";
  readonly records: readonly SessionPreviewRecord[];
  readonly message?: string;
}

export interface SessionPreviewInput {
  readonly eventId: string;
  readonly remoteEventId: string;
  readonly snapshot: PublishedProgramSnapshot;
  readonly mapping: SessionMappingDefinition;
  readonly remoteRecords: readonly SessionRemoteRecord[];
  readonly connection: AcceleventsConnection;
  readonly adapter: AcceleventsAdapter;
}

const titleSources = new Set<SessionMappingDefinition["title"]>(["session.title", "event.name"]);
const descriptionSources = new Set<SessionMappingDefinition["description"]>([
  "session.description",
  "event.theme",
  "omit",
]);
const speakerSources = new Set<SessionMappingDefinition["speakers"]>(["linked-speakers", "omit"]);

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new RepositoryError("invalid-input", `${field} is required.`);
  return normalized;
}

export function parseSessionMappingDefinition(value: unknown): SessionMappingDefinition {
  if (typeof value !== "object" || value === null) {
    throw new RepositoryError("invalid-input", "The session field mapping is invalid.");
  }
  const candidate = value as Record<string, unknown>;
  if (
    !titleSources.has(candidate.title as SessionMappingDefinition["title"]) ||
    !descriptionSources.has(candidate.description as SessionMappingDefinition["description"]) ||
    !speakerSources.has(candidate.speakers as SessionMappingDefinition["speakers"])
  ) {
    throw new RepositoryError("invalid-input", "The session field mapping contains an unsupported source.");
  }
  return {
    title: candidate.title as SessionMappingDefinition["title"],
    description: candidate.description as SessionMappingDefinition["description"],
    speakers: candidate.speakers as SessionMappingDefinition["speakers"],
  };
}

function mappingView(stored: {
  readonly id: string;
  readonly configurationId: string;
  readonly versions: readonly {
    readonly versionNumber: number;
    readonly definition: Prisma.JsonValue;
    readonly createdAt: Date;
  }[];
}): SessionMappingView {
  const latest = stored.versions[0];
  if (!latest) throw new Error(`Integration field mapping ${stored.id} has no version.`);
  return {
    id: stored.id,
    configurationId: stored.configurationId,
    versionNumber: latest.versionNumber,
    definition: parseSessionMappingDefinition(latest.definition),
    createdAt: latest.createdAt,
  };
}

export class AcceleventsSessionMappingRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async get(eventId: string): Promise<SessionMappingView | null> {
    const stored = await this.#client.integrationFieldMapping.findFirst({
      where: {
        eventId,
        resourceType: "session",
        key: "outbound-session",
        configuration: { provider: IntegrationProvider.ACCELEVENTS },
      },
      select: {
        id: true,
        configurationId: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { versionNumber: true, definition: true, createdAt: true },
        },
      },
    });
    return stored ? mappingView(stored) : null;
  }

  async save(eventId: string, definitionInput: SessionMappingDefinition): Promise<SessionMappingView> {
    const definition = parseSessionMappingDefinition(definitionInput);
    const mappingId = await this.#client.$transaction(async (transaction) => {
      const configuration = await transaction.integrationConfiguration.findUnique({
        where: { eventId_provider: { eventId, provider: IntegrationProvider.ACCELEVENTS } },
        select: { id: true },
      });
      if (!configuration) throw new RepositoryError("not-found", "The Accelevents configuration was not found.");
      const mapping = await transaction.integrationFieldMapping.upsert({
        where: {
          configurationId_resourceType_key: {
            configurationId: configuration.id,
            resourceType: "session",
            key: "outbound-session",
          },
        },
        create: {
          eventId,
          configurationId: configuration.id,
          resourceType: "session",
          key: "outbound-session",
        },
        update: {},
        select: { id: true },
      });
      const latest = await transaction.integrationFieldMappingVersion.findFirst({
        where: { mappingId: mapping.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      await transaction.integrationFieldMappingVersion.create({
        data: {
          eventId,
          configurationId: configuration.id,
          mappingId: mapping.id,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          definition: definition as unknown as Prisma.InputJsonValue,
        },
      });
      return mapping.id;
    });
    const saved = await this.#client.integrationFieldMapping.findFirst({
      where: { eventId, id: mappingId },
      select: {
        id: true,
        configurationId: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { versionNumber: true, definition: true, createdAt: true },
        },
      },
    });
    if (!saved) throw new RepositoryError("not-found", "The Accelevents session mapping was not found.");
    return mappingView(saved);
  }
}

function mappedTitle(
  snapshot: PublishedProgramSnapshot,
  session: PublishedProgramSnapshot["sessions"][number],
  mapping: SessionMappingDefinition,
): string {
  return mapping.title === "event.name" ? snapshot.event.name.trim() : session.title.trim();
}

function mappedDescription(
  snapshot: PublishedProgramSnapshot,
  session: PublishedProgramSnapshot["sessions"][number],
  mapping: SessionMappingDefinition,
): string {
  if (mapping.description === "omit") return "";
  if (mapping.description === "event.theme") return snapshot.event.theme?.trim() ?? "";
  return session.description?.trim() ?? "";
}

function validInstant(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildSessionOutboundRecords(
  eventId: string,
  snapshot: PublishedProgramSnapshot,
  mappingInput: SessionMappingDefinition,
  remoteRecords: readonly SessionRemoteRecord[],
): SessionPreviewRecord[] {
  if (snapshot.event.id !== eventId) {
    throw new RepositoryError("not-found", "The published program does not belong to this event.");
  }
  const mapping = parseSessionMappingDefinition(mappingInput);
  const placementsBySession = new Map<string, PublishedProgramSnapshot["placements"]>();
  for (const placement of snapshot.placements) {
    placementsBySession.set(placement.sessionId, [...(placementsBySession.get(placement.sessionId) ?? []), placement]);
  }
  const rooms = new Map(snapshot.rooms.map((room) => [room.id, room.name]));
  const tracks = new Map(snapshot.tracks.map((track) => [track.id, track.name]));
  const links = new Map(remoteRecords.map((record) => [`${record.resourceType}:${record.localId}`, record]));

  return snapshot.sessions.map((session) => {
    const explanations: string[] = [];
    const placements = placementsBySession.get(session.id) ?? [];
    const placement = placements[0];
    if (placements.length !== 1 || !placement) explanations.push("Session must have exactly one published placement.");
    const startsAt = placement?.startsAt ?? "";
    const endsAt = placement?.endsAt ?? "";
    const start = validInstant(startsAt);
    const end = validInstant(endsAt);
    if (placement && (start === null || end === null || end <= start)) {
      explanations.push("Published schedule times are invalid or out of order.");
    }
    const roomName = placement ? rooms.get(placement.roomId) : undefined;
    if (placement && !roomName) explanations.push("Published placement references an unavailable room.");
    const missingTrack = placement?.trackIds.find((trackId) => !tracks.has(trackId));
    if (missingTrack) explanations.push("Published placement references an unavailable track.");

    const title = mappedTitle(snapshot, session, mapping);
    if (title === "") explanations.push("Accelevents requires a session title.");
    const speakerRemoteIds =
      mapping.speakers === "omit"
        ? []
        : session.speakerIds.flatMap((speakerId) => {
            const link = links.get(`speaker:${speakerId}`);
            if (!link || link.status !== IntegrationRemoteRecordStatus.ACTIVE) {
              explanations.push(`Speaker ${speakerId} is not linked to an active Accelevents speaker.`);
              return [];
            }
            return [link.remoteId];
          });
    const sessionLink = links.get(`session:${session.id}`);
    const stale = sessionLink?.status === IntegrationRemoteRecordStatus.STALE;
    if (stale) explanations.push("The existing Accelevents session link is stale and must be reconciled first.");
    let action: SessionPreviewAction = "create";
    if (explanations.length > 0) action = stale && explanations.length === 1 ? "skipped" : "invalid";

    return {
      localId: session.id,
      remoteId: sessionLink?.remoteId ?? null,
      title,
      description: mappedDescription(snapshot, session, mapping),
      speakerRemoteIds,
      startsAt,
      endsAt,
      roomName: roomName ?? "",
      trackNames: placement?.trackIds.map((trackId) => tracks.get(trackId) ?? "") ?? [],
      action,
      explanations,
    };
  });
}

async function collectPages<T>(
  load: (page?: AcceleventsPageRequest) => Promise<{ readonly ok: boolean; readonly value?: AcceleventsPage<T> }>,
): Promise<readonly T[] | null> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await load(cursor ? { cursor } : undefined);
    if (!result.ok || !result.value) return null;
    items.push(...result.value.items);
    const next = result.value.nextCursor;
    if (next === null) return items;
    if (seen.has(next)) return null;
    seen.add(next);
    cursor = next;
  } while (cursor);
  return items;
}

function sameSession(remote: AcceleventsSession, local: SessionPreviewRecord): boolean {
  return (
    remote.title === local.title &&
    remote.description === local.description &&
    remote.speakerRemoteIds.length === local.speakerRemoteIds.length &&
    remote.speakerRemoteIds.every((speakerId, index) => speakerId === local.speakerRemoteIds[index])
  );
}

export async function previewAcceleventsSessions(input: SessionPreviewInput): Promise<SessionPreviewResult> {
  requiredText(input.remoteEventId, "remoteEventId");
  if (input.connection.remoteEventId !== input.remoteEventId) {
    throw new RepositoryError("not-found", "The Accelevents connection does not belong to this event configuration.");
  }
  const local = buildSessionOutboundRecords(input.eventId, input.snapshot, input.mapping, input.remoteRecords);
  const credential = await input.adapter.checkCredentials(input.connection);
  if (!credential.ok || credential.value.remoteEventId !== input.remoteEventId) {
    return {
      status: "disconnected",
      records: local,
      message: "Accelevents is unavailable. Download the CSV fallback.",
    };
  }
  const [remoteSessions, remoteSpeakers] = await Promise.all([
    collectPages((page) => input.adapter.listSessions(input.connection, page)),
    collectPages((page) => input.adapter.listSpeakers(input.connection, page)),
  ]);
  if (!remoteSessions || !remoteSpeakers) {
    return {
      status: "disconnected",
      records: local,
      message: "Accelevents is unavailable. Download the CSV fallback.",
    };
  }
  const sessionsById = new Map(remoteSessions.map((session) => [session.remoteId, session]));
  const speakerIds = new Set(remoteSpeakers.map((speaker: AcceleventsSpeaker) => speaker.remoteId));
  return {
    status: "ready",
    records: local.map((record) => {
      if (record.action === "invalid" || record.action === "skipped") return record;
      const missingSpeaker = record.speakerRemoteIds.find((speakerId) => !speakerIds.has(speakerId));
      if (missingSpeaker) {
        return {
          ...record,
          action: "invalid",
          explanations: [...record.explanations, `Linked Accelevents speaker ${missingSpeaker} is unavailable.`],
        };
      }
      if (!record.remoteId) return { ...record, action: "create", explanations: ["No linked remote session exists."] };
      const remote = sessionsById.get(record.remoteId);
      if (!remote) {
        return {
          ...record,
          action: "invalid",
          explanations: [`Linked Accelevents session ${record.remoteId} is unavailable.`],
        };
      }
      return sameSession(remote, record)
        ? { ...record, action: "unchanged", explanations: ["Remote fields already match this mapping."] }
        : { ...record, action: "update", explanations: ["One or more mapped fields differ remotely."] };
    }),
  };
}

export function toAcceleventsSessionInput(record: SessionPreviewRecord): AcceleventsSessionInput {
  return { title: record.title, description: record.description, speakerRemoteIds: record.speakerRemoteIds };
}
