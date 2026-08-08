import type { Event, EventType, Prisma, PrismaClient, Room, Track } from "../../generated/prisma/client.ts";

export type RepositoryErrorCode = "conflict" | "invalid-input" | "not-found";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
  }
}

export interface CreateEventInput {
  readonly name: string;
  readonly slug: string;
  readonly type?: EventType;
  readonly websiteUrl?: string | null;
  readonly location?: string | null;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly theme?: string | null;
  readonly exhibitorsEnabled?: boolean;
  readonly sponsorsEnabled?: boolean;
  readonly logoObjectKey?: string | null;
  readonly backgroundObjectKey?: string | null;
}

export type UpdateEventInput = Partial<CreateEventInput>;

export interface CreateRoomInput {
  readonly eventId: string;
  readonly name: string;
}

export interface CreateTrackInput extends CreateRoomInput {
  readonly color: string;
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    invalid(`${field} is required.`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function validateTimezone(timezone: string): string {
  const normalized = requireText(timezone, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    invalid("timezone must be a valid IANA time-zone identifier.");
  }
  return normalized;
}

function validateUrl(value: string | null | undefined): string | null | undefined {
  const normalized = optionalText(value);
  if (normalized === undefined || normalized === null) {
    return normalized;
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    invalid("websiteUrl must be a valid HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    invalid("websiteUrl must be a valid HTTP or HTTPS URL.");
  }
  return url.toString();
}

function validateEvent(input: CreateEventInput): CreateEventInput {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt) {
    invalid("startsAt must be earlier than endsAt.");
  }

  const slug = requireText(input.slug, "slug").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    invalid("slug must contain lowercase letters, numbers, and single hyphens.");
  }

  return {
    name: requireText(input.name, "name"),
    slug,
    type: input.type,
    websiteUrl: validateUrl(input.websiteUrl),
    location: optionalText(input.location),
    timezone: validateTimezone(input.timezone),
    startsAt,
    endsAt,
    theme: optionalText(input.theme),
    exhibitorsEnabled: input.exhibitorsEnabled,
    sponsorsEnabled: input.sponsorsEnabled,
    logoObjectKey: optionalText(input.logoObjectKey),
    backgroundObjectKey: optionalText(input.backgroundObjectKey),
  };
}

function mapDatabaseError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError("conflict", "A record with the same event-scoped identity already exists.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned record was not found.");
    }
  }
  throw error;
}

async function requireEvent(client: PrismaClient, eventId: string): Promise<void> {
  const event = await client.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) {
    throw new RepositoryError("not-found", "The event was not found.");
  }
}

export class EventRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async create(input: CreateEventInput): Promise<Event> {
    try {
      return await this.client.event.create({ data: validateEvent(input) });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async get(id: string): Promise<Event | null> {
    return this.client.event.findUnique({ where: { id } });
  }

  async list(ids: readonly string[]): Promise<Event[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.client.event.findMany({ where: { id: { in: [...ids] } }, orderBy: { startsAt: "asc" } });
  }

  async update(id: string, input: UpdateEventInput): Promise<Event> {
    const current = await this.get(id);
    if (!current) {
      throw new RepositoryError("not-found", "The event was not found.");
    }
    const validated = validateEvent({ ...current, ...input });
    try {
      return await this.client.event.update({ where: { id }, data: validated });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.client.event.delete({ where: { id } });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}

abstract class OrderedEventRepository<TRecord extends Room | Track> {
  protected readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  abstract list(eventId: string): Promise<TRecord[]>;
  protected abstract updateOrder(
    transaction: Prisma.TransactionClient,
    eventId: string,
    id: string,
    sortOrder: number,
  ): Promise<number>;

  async reorder(eventId: string, orderedIds: readonly string[]): Promise<TRecord[]> {
    await requireEvent(this.client, eventId);
    const current = await this.list(eventId);
    const uniqueIds = new Set(orderedIds);
    if (uniqueIds.size !== orderedIds.length || current.length !== orderedIds.length) {
      invalid("orderedIds must contain every event-owned record exactly once.");
    }
    const currentIds = new Set(current.map(({ id }) => id));
    if (orderedIds.some((id) => !currentIds.has(id))) {
      invalid("orderedIds must contain every event-owned record exactly once.");
    }

    await this.client.$transaction(async (transaction) => {
      for (const [index, id] of orderedIds.entries()) {
        await this.updateOrder(transaction, eventId, id, -(index + 1));
      }
      for (const [index, id] of orderedIds.entries()) {
        await this.updateOrder(transaction, eventId, id, index);
      }
    });
    return this.list(eventId);
  }
}

export class RoomRepository extends OrderedEventRepository<Room> {
  async create(input: CreateRoomInput): Promise<Room> {
    await requireEvent(this.client, input.eventId);
    const name = requireText(input.name, "name");
    const last = await this.client.room.findFirst({
      where: { eventId: input.eventId },
      orderBy: { sortOrder: "desc" },
    });
    try {
      return await this.client.room.create({
        data: { eventId: input.eventId, name, sortOrder: (last?.sortOrder ?? -1) + 1 },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async list(eventId: string): Promise<Room[]> {
    return this.client.room.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }

  async get(eventId: string, id: string): Promise<Room | null> {
    return this.client.room.findFirst({ where: { eventId, id } });
  }

  async update(eventId: string, id: string, name: string): Promise<Room> {
    try {
      const result = await this.client.room.updateMany({
        where: { eventId, id },
        data: { name: requireText(name, "name") },
      });
      if (result.count === 0) {
        throw new RepositoryError("not-found", "The event-owned room was not found.");
      }
      const room = await this.get(eventId, id);
      if (!room) {
        throw new RepositoryError("not-found", "The event-owned room was not found.");
      }
      return room;
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async delete(eventId: string, id: string): Promise<void> {
    const result = await this.client.room.deleteMany({ where: { eventId, id } });
    if (result.count === 0) {
      throw new RepositoryError("not-found", "The event-owned room was not found.");
    }
  }

  protected async updateOrder(
    transaction: Prisma.TransactionClient,
    eventId: string,
    id: string,
    sortOrder: number,
  ): Promise<number> {
    const result = await transaction.room.updateMany({ where: { eventId, id }, data: { sortOrder } });
    return result.count;
  }
}

export class TrackRepository extends OrderedEventRepository<Track> {
  async create(input: CreateTrackInput): Promise<Track> {
    await requireEvent(this.client, input.eventId);
    const name = requireText(input.name, "name");
    const color = requireText(input.color, "color");
    const last = await this.client.track.findFirst({
      where: { eventId: input.eventId },
      orderBy: { sortOrder: "desc" },
    });
    try {
      return await this.client.track.create({
        data: { eventId: input.eventId, name, color, sortOrder: (last?.sortOrder ?? -1) + 1 },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async list(eventId: string): Promise<Track[]> {
    return this.client.track.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }

  async get(eventId: string, id: string): Promise<Track | null> {
    return this.client.track.findFirst({ where: { eventId, id } });
  }

  async update(
    eventId: string,
    id: string,
    input: { readonly name?: string; readonly color?: string },
  ): Promise<Track> {
    const data = {
      ...(input.name === undefined ? {} : { name: requireText(input.name, "name") }),
      ...(input.color === undefined ? {} : { color: requireText(input.color, "color") }),
    };
    try {
      const result = await this.client.track.updateMany({ where: { eventId, id }, data });
      if (result.count === 0) {
        throw new RepositoryError("not-found", "The event-owned track was not found.");
      }
      const track = await this.get(eventId, id);
      if (!track) {
        throw new RepositoryError("not-found", "The event-owned track was not found.");
      }
      return track;
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async delete(eventId: string, id: string): Promise<void> {
    const result = await this.client.track.deleteMany({ where: { eventId, id } });
    if (result.count === 0) {
      throw new RepositoryError("not-found", "The event-owned track was not found.");
    }
  }

  protected async updateOrder(
    transaction: Prisma.TransactionClient,
    eventId: string,
    id: string,
    sortOrder: number,
  ): Promise<number> {
    const result = await transaction.track.updateMany({ where: { eventId, id }, data: { sortOrder } });
    return result.count;
  }
}
