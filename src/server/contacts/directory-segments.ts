import type { DirectorySegment, Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import type { DirectoryPeopleFilters } from "./repositories.ts";

export interface DirectorySegmentRecord extends Omit<DirectorySegment, "filters"> {
  readonly filters: DirectoryPeopleFilters;
}

function optionalText(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized === "" ? undefined : normalized.slice(0, maxLength);
}

export function normalizeDirectoryPeopleFilters(input: unknown): DirectoryPeopleFilters {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const stored = input as Record<string, unknown>;
  return {
    query: optionalText(stored.query),
    organization: optionalText(stored.organization),
    jobTitle: optionalText(stored.jobTitle),
    eventId: optionalText(stored.eventId, 36),
  };
}

function fromStored(segment: DirectorySegment): DirectorySegmentRecord {
  return { ...segment, filters: normalizeDirectoryPeopleFilters(segment.filters) };
}

function normalizedName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 100) {
    throw new RepositoryError("invalid-input", "Segment names must be between 1 and 100 characters.");
  }
  return name;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002") {
    throw new RepositoryError("conflict", "A segment with this name already exists.");
  }
  throw error;
}

export class DirectorySegmentRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  private async organizationId(eventId: string): Promise<string> {
    const event = await this.client.event.findUnique({ where: { id: eventId }, select: { orgId: true } });
    if (!event) throw new RepositoryError("not-found", "This event is not available.");
    return event.orgId;
  }

  async listForEvent(eventId: string): Promise<readonly DirectorySegmentRecord[]> {
    const orgId = await this.organizationId(eventId);
    return (
      await this.client.directorySegment.findMany({ where: { orgId }, orderBy: [{ name: "asc" }, { id: "asc" }] })
    ).map(fromStored);
  }

  async createForEvent(
    eventId: string,
    name: string,
    filters: DirectoryPeopleFilters,
  ): Promise<DirectorySegmentRecord> {
    const orgId = await this.organizationId(eventId);
    const normalizedFilters = normalizeDirectoryPeopleFilters(filters);
    if (Object.values(normalizedFilters).every((value) => value === undefined)) {
      throw new RepositoryError("invalid-input", "Apply at least one filter before saving a segment.");
    }
    try {
      return fromStored(
        await this.client.directorySegment.create({
          data: { orgId, name: normalizedName(name), filters: normalizedFilters as Prisma.InputJsonValue },
        }),
      );
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
