import { addMinutes, differenceInMinutes } from "date-fns";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { boundedLimit, collectPages, LIST_BOUNDS, type ListPage, toListPage } from "../database/list-bounds.ts";
import { RepositoryError } from "../events/repositories.ts";
import { type AgendaConflict, validateAgendaConflicts } from "./conflicts.ts";

export interface ListAgendaPlacementsOptions {
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface AgendaPlacementDetails {
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly roomId: string;
  readonly trackIds?: readonly string[];
  readonly speakerIds?: readonly string[];
}

export interface PlaceAgendaSessionInput extends AgendaPlacementDetails {
  readonly eventId: string;
  readonly sessionId: string;
}

export interface UpdateAgendaPlacementInput {
  readonly expectedVersion: number;
  readonly startsAt?: Date;
  readonly durationMinutes?: number;
  readonly roomId?: string;
  readonly trackIds?: readonly string[];
  readonly speakerIds?: readonly string[];
}

export interface PersistedAgendaPlacement {
  readonly id: string;
  readonly eventId: string;
  readonly sessionId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly durationMinutes: number;
  readonly timezone: string;
  readonly roomId: string;
  readonly trackIds: readonly string[];
  readonly speakerIds: readonly string[];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type AgendaConflictPolicy = "prevent" | "explicit-confirm";

export interface AgendaConflictOptions {
  readonly policy?: AgendaConflictPolicy;
  readonly conflictsConfirmed?: boolean;
}

export class AgendaConflictError extends RepositoryError {
  readonly conflicts: readonly AgendaConflict[];
  readonly confirmationRequired: boolean;

  constructor(conflicts: readonly AgendaConflict[], policy: AgendaConflictPolicy) {
    super(
      "conflict",
      policy === "explicit-confirm"
        ? "Review and confirm the agenda conflicts before saving."
        : "Resolve the agenda conflicts before saving.",
    );
    this.name = "AgendaConflictError";
    this.conflicts = conflicts;
    this.confirmationRequired = policy === "explicit-confirm";
  }
}

const placementInclude = {
  event: { select: { timezone: true } },
  tracks: { orderBy: { sortOrder: "asc" } },
  speakers: { orderBy: { sortOrder: "asc" } },
} as const satisfies Prisma.AgendaPlacementInclude;

type StoredPlacement = Prisma.AgendaPlacementGetPayload<{ include: typeof placementInclude }>;

interface ValidatedPlacement {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly durationMinutes: number;
  readonly roomId: string;
  readonly trackIds: readonly string[];
  readonly speakerIds: readonly string[];
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requireUniqueIds(ids: readonly string[], field: string): readonly string[] {
  if (new Set(ids).size !== ids.length) invalid(`${field} must contain each record at most once.`);
  return [...ids];
}

function validatePlacement(input: AgendaPlacementDetails): ValidatedPlacement {
  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime())) invalid("startsAt must be a valid instant.");
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    invalid("durationMinutes must be a positive integer.");
  }
  const roomId = input.roomId.trim();
  if (roomId === "") invalid("roomId is required.");
  return {
    startsAt,
    endsAt: addMinutes(startsAt, input.durationMinutes),
    durationMinutes: input.durationMinutes,
    roomId,
    trackIds: requireUniqueIds(input.trackIds ?? [], "trackIds"),
    speakerIds: requireUniqueIds(input.speakerIds ?? [], "speakerIds"),
  };
}

async function requirePlacementReferences(
  transaction: Prisma.TransactionClient,
  eventId: string,
  sessionId: string,
  placement: ValidatedPlacement,
): Promise<{ readonly startsAt: Date; readonly endsAt: Date; readonly timezone: string }> {
  const event = await transaction.event.findUnique({
    where: { id: eventId },
    select: { startsAt: true, endsAt: true, timezone: true },
  });
  const session = await transaction.programSession.findFirst({
    where: { eventId, id: sessionId, archivedAt: null },
    select: {
      id: true,
      parentSessionId: true,
      parentSession: { select: { agendaPlacement: { select: { startsAt: true, endsAt: true } } } },
    },
  });
  const room = await transaction.room.findFirst({
    where: { eventId, id: placement.roomId },
    select: { id: true },
  });
  const trackCount = await transaction.track.count({
    where: { eventId, id: { in: [...placement.trackIds] } },
  });
  const speakerCount = await transaction.speaker.count({
    where: { eventId, id: { in: [...placement.speakerIds] } },
  });
  if (!event) throw new RepositoryError("not-found", "The event was not found.");
  if (!session) throw new RepositoryError("not-found", "The active event-owned session was not found.");
  if (!room) throw new RepositoryError("not-found", "The event-owned room was not found.");
  if (trackCount !== placement.trackIds.length) {
    throw new RepositoryError("not-found", "Every agenda track must belong to the placement event.");
  }
  if (speakerCount !== placement.speakerIds.length) {
    throw new RepositoryError("not-found", "Every agenda speaker must belong to the placement event.");
  }
  if (placement.startsAt < event.startsAt || placement.endsAt > event.endsAt) {
    invalid("The agenda placement must stay within the event bounds.");
  }
  if (session.parentSessionId) {
    const parentPlacement = session.parentSession?.agendaPlacement;
    if (!parentPlacement) invalid("Schedule the parent session before placing a subsession.");
    if (placement.startsAt < parentPlacement.startsAt || placement.endsAt > parentPlacement.endsAt) {
      invalid("A subsession placement must stay within its parent session window.");
    }
  }
  return event;
}

async function enforceConflictPolicy(
  transaction: Prisma.TransactionClient,
  eventId: string,
  event: { readonly startsAt: Date; readonly endsAt: Date; readonly timezone: string },
  candidate: { readonly id: string } & ValidatedPlacement,
  candidateSessionId: string,
  excludedPlacementId: string | null,
  options: AgendaConflictOptions,
): Promise<void> {
  const policy = options.policy ?? "prevent";
  const current = await transaction.agendaPlacement.findMany({
    where: { eventId, ...(excludedPlacementId ? { id: { not: excludedPlacementId } } : {}) },
    include: {
      tracks: { orderBy: { sortOrder: "asc" } },
      speakers: { orderBy: { sortOrder: "asc" } },
    },
  });
  const placementSessionIds = new Map(current.map((placement) => [placement.id, placement.sessionId]));
  placementSessionIds.set(candidate.id, candidateSessionId);
  const sessionIds = [...placementSessionIds.values()];
  const sessionParents = new Map(
    (
      await transaction.programSession.findMany({
        where: { eventId, id: { in: sessionIds } },
        select: { id: true, parentSessionId: true },
      })
    ).map((session) => [session.id, session.parentSessionId]),
  );
  const conflicts = validateAgendaConflicts(event, [
    ...current.map((placement) => ({
      id: placement.id,
      startsAt: placement.startsAt,
      endsAt: placement.endsAt,
      roomId: placement.roomId,
      trackIds: placement.tracks.map(({ trackId }) => trackId),
      speakerIds: placement.speakers.map(({ speakerId }) => speakerId),
    })),
    candidate,
  ]).filter(({ placementIds }) => {
    if (!placementIds.includes(candidate.id)) return false;
    if (placementIds.length !== 2) return true;
    const [leftPlacementId, rightPlacementId] = placementIds;
    const leftSessionId = placementSessionIds.get(leftPlacementId);
    const rightSessionId = placementSessionIds.get(rightPlacementId);
    if (!leftSessionId || !rightSessionId) return true;
    return sessionParents.get(leftSessionId) !== rightSessionId && sessionParents.get(rightSessionId) !== leftSessionId;
  });

  if (conflicts.length > 0 && !(policy === "explicit-confirm" && options.conflictsConfirmed === true)) {
    throw new AgendaConflictError(conflicts, policy);
  }
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") throw new RepositoryError("conflict", "The session is already placed on the agenda.");
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned agenda reference was not found.");
    }
  }
  throw error;
}

function fromStored(stored: StoredPlacement): PersistedAgendaPlacement {
  return {
    id: stored.id,
    eventId: stored.eventId,
    sessionId: stored.sessionId,
    startsAt: stored.startsAt,
    endsAt: stored.endsAt,
    durationMinutes: differenceInMinutes(stored.endsAt, stored.startsAt),
    timezone: stored.event.timezone,
    roomId: stored.roomId,
    trackIds: stored.tracks.map(({ trackId }) => trackId),
    speakerIds: stored.speakers.map(({ speakerId }) => speakerId),
    version: stored.version,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

export class AgendaPlacementRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async place(input: PlaceAgendaSessionInput, options: AgendaConflictOptions = {}): Promise<PersistedAgendaPlacement> {
    try {
      const placement = validatePlacement(input);
      const id = await this.client.$transaction(async (transaction) => {
        const event = await requirePlacementReferences(transaction, input.eventId, input.sessionId, placement);
        const candidateId = `new:${input.sessionId}`;
        await enforceConflictPolicy(
          transaction,
          input.eventId,
          event,
          { id: candidateId, ...placement },
          input.sessionId,
          null,
          options,
        );
        const created = await transaction.agendaPlacement.create({
          data: {
            eventId: input.eventId,
            sessionId: input.sessionId,
            roomId: placement.roomId,
            startsAt: placement.startsAt,
            endsAt: placement.endsAt,
          },
          select: { id: true },
        });
        await this.replaceRelations(transaction, input.eventId, created.id, placement);
        return created.id;
      });
      return await this.require(input.eventId, id);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async update(
    eventId: string,
    placementId: string,
    input: UpdateAgendaPlacementInput,
    options: AgendaConflictOptions = {},
  ): Promise<PersistedAgendaPlacement> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion <= 0) {
      invalid("expectedVersion must be a positive integer.");
    }
    try {
      await this.client.$transaction(async (transaction) => {
        const current = await transaction.agendaPlacement.findFirst({
          where: { eventId, id: placementId },
          include: placementInclude,
        });
        if (!current) throw new RepositoryError("not-found", "The event-owned agenda placement was not found.");
        const placement = validatePlacement({
          startsAt: input.startsAt ?? current.startsAt,
          durationMinutes: input.durationMinutes ?? differenceInMinutes(current.endsAt, current.startsAt),
          roomId: input.roomId ?? current.roomId,
          trackIds: input.trackIds ?? current.tracks.map(({ trackId }) => trackId),
          speakerIds: input.speakerIds ?? current.speakers.map(({ speakerId }) => speakerId),
        });
        const event = await requirePlacementReferences(transaction, eventId, current.sessionId, placement);
        await enforceConflictPolicy(
          transaction,
          eventId,
          event,
          { id: placementId, ...placement },
          current.sessionId,
          placementId,
          options,
        );
        const updated = await transaction.agendaPlacement.updateMany({
          where: { eventId, id: placementId, version: input.expectedVersion },
          data: {
            startsAt: placement.startsAt,
            endsAt: placement.endsAt,
            roomId: placement.roomId,
            version: { increment: 1 },
          },
        });
        if (updated.count === 0) {
          throw new RepositoryError("conflict", "The agenda placement changed; reload it before saving again.");
        }
        await transaction.agendaPlacementTrack.deleteMany({ where: { placementId } });
        await transaction.agendaPlacementSpeaker.deleteMany({ where: { placementId } });
        await this.replaceRelations(transaction, eventId, placementId, placement);
      });
      return await this.require(eventId, placementId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async remove(eventId: string, placementId: string, expectedVersion: number): Promise<void> {
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0)
      invalid("expectedVersion must be a positive integer.");
    const existing = await this.client.agendaPlacement.findFirst({
      where: { eventId, id: placementId },
      select: { id: true },
    });
    if (!existing) throw new RepositoryError("not-found", "The event-owned agenda placement was not found.");
    const removed = await this.client.agendaPlacement.deleteMany({
      where: { eventId, id: placementId, version: expectedVersion },
    });
    if (removed.count === 0) {
      throw new RepositoryError("conflict", "The agenda placement changed; reload it before removing it.");
    }
  }

  async get(eventId: string, placementId: string): Promise<PersistedAgendaPlacement | null> {
    const placement = await this.client.agendaPlacement.findFirst({
      where: { eventId, id: placementId },
      include: placementInclude,
    });
    return placement ? fromStored(placement) : null;
  }

  /** One bounded page of an event's placements, ordered by start time. */
  async listPage(
    eventId: string,
    options: ListAgendaPlacementsOptions = {},
  ): Promise<ListPage<PersistedAgendaPlacement>> {
    const limit = boundedLimit(options.limit, LIST_BOUNDS.agendaPlacements);
    const placements = await this.client.agendaPlacement.findMany({
      where: { eventId },
      include: placementInclude,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    return toListPage(placements.map(fromStored), limit, (placement) => placement.id);
  }

  async list(eventId: string): Promise<PersistedAgendaPlacement[]> {
    return collectPages((cursor, take) => this.listPage(eventId, { cursor, limit: take }));
  }

  private async replaceRelations(
    transaction: Prisma.TransactionClient,
    eventId: string,
    placementId: string,
    placement: ValidatedPlacement,
  ): Promise<void> {
    if (placement.trackIds.length > 0) {
      await transaction.agendaPlacementTrack.createMany({
        data: placement.trackIds.map((trackId, sortOrder) => ({ eventId, placementId, trackId, sortOrder })),
      });
    }
    if (placement.speakerIds.length > 0) {
      await transaction.agendaPlacementSpeaker.createMany({
        data: placement.speakerIds.map((speakerId, sortOrder) => ({ eventId, placementId, speakerId, sortOrder })),
      });
    }
  }

  private async require(eventId: string, placementId: string): Promise<PersistedAgendaPlacement> {
    const placement = await this.get(eventId, placementId);
    if (!placement) throw new RepositoryError("not-found", "The event-owned agenda placement was not found.");
    return placement;
  }
}
