import { type Prisma, type PrismaClient, PublishedProgramState } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface PublishedProgramEventSnapshot {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly websiteUrl: string | null;
  readonly location: string | null;
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly theme: string | null;
}

export interface PublishedProgramRoomSnapshot {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
}

export interface PublishedProgramTrackSnapshot extends PublishedProgramRoomSnapshot {
  readonly color: string;
}

export interface PublishedProgramSpeakerSnapshot {
  readonly id: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly preferredName: string | null;
  readonly pronouns: string | null;
  readonly organization: string | null;
  readonly jobTitle: string | null;
  readonly biography: string | null;
  readonly websiteUrl: string | null;
  readonly photoObjectKey: string | null;
}

export interface PublishedProgramSessionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly trackId: string | null;
  readonly speakerIds: readonly string[];
}

export interface PublishedProgramPlacementSnapshot {
  readonly id: string;
  readonly sessionId: string;
  readonly roomId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly trackIds: readonly string[];
  readonly speakerIds: readonly string[];
}

export interface PublishedProgramSnapshot {
  readonly schemaVersion: 1;
  readonly event: PublishedProgramEventSnapshot;
  readonly rooms: readonly PublishedProgramRoomSnapshot[];
  readonly tracks: readonly PublishedProgramTrackSnapshot[];
  readonly speakers: readonly PublishedProgramSpeakerSnapshot[];
  readonly sessions: readonly PublishedProgramSessionSnapshot[];
  readonly placements: readonly PublishedProgramPlacementSnapshot[];
}

export interface PersistedPublishedProgramVersion {
  readonly id: string;
  readonly eventId: string;
  readonly versionNumber: number;
  readonly state: PublishedProgramState;
  readonly actorPrincipalId: string;
  readonly snapshot: PublishedProgramSnapshot | null;
  readonly createdAt: Date;
}

interface PublicationInput {
  readonly eventId: string;
  readonly actorPrincipalId: string;
  readonly expectedVersion: number;
}

const snapshotEventSelect = {
  id: true,
  name: true,
  slug: true,
  websiteUrl: true,
  location: true,
  timezone: true,
  startsAt: true,
  endsAt: true,
  theme: true,
  rooms: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
  tracks: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
  speakers: {
    orderBy: { id: "asc" },
    include: { profileVersions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  },
  agendaPlacements: {
    where: { session: { archivedAt: null } },
    orderBy: [{ startsAt: "asc" }, { roomId: "asc" }, { id: "asc" }],
    include: {
      session: {
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: { participants: { orderBy: { sortOrder: "asc" } } },
          },
        },
      },
      tracks: { orderBy: { sortOrder: "asc" } },
      speakers: { orderBy: { sortOrder: "asc" } },
    },
  },
} as const satisfies Prisma.EventSelect;

type StoredSnapshotEvent = Prisma.EventGetPayload<{ select: typeof snapshotEventSelect }>;

function conflict(message: string): never {
  throw new RepositoryError("conflict", message);
}

function requireExpectedVersion(expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new RepositoryError("invalid-input", "expectedVersion must be a non-negative integer.");
  }
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002" || code === "P2034") {
      conflict("The published program changed concurrently. Reload it and try again.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned published program was not found.");
    }
  }
  throw error;
}

function fromStored(stored: {
  readonly id: string;
  readonly eventId: string;
  readonly versionNumber: number;
  readonly state: PublishedProgramState;
  readonly actorPrincipalId: string;
  readonly snapshot: Prisma.JsonValue | null;
  readonly createdAt: Date;
}): PersistedPublishedProgramVersion {
  return {
    ...stored,
    snapshot: stored.snapshot as PublishedProgramSnapshot | null,
  };
}

function buildSnapshot(event: StoredSnapshotEvent): PublishedProgramSnapshot {
  const publishedSpeakers = event.speakers.flatMap((speaker) => {
    const profile = speaker.profileVersions[0];
    if (!profile?.consentToPublishProfile) return [];
    return [
      {
        id: speaker.id,
        givenName: profile.givenName,
        familyName: profile.familyName,
        preferredName: profile.preferredName,
        pronouns: profile.pronouns,
        organization: profile.organization,
        jobTitle: profile.jobTitle,
        biography: profile.biography,
        websiteUrl: profile.websiteUrl,
        photoObjectKey: profile.photoObjectKey,
      },
    ];
  });
  const publishedSpeakerIds = new Set(publishedSpeakers.map(({ id }) => id));
  const sessions = event.agendaPlacements.map(({ session }) => {
    const version = session.versions[0];
    if (!version) throw new RepositoryError("invalid-input", `Session ${session.id} has no version to publish.`);
    return {
      id: session.id,
      title: version.title,
      description: version.description,
      durationMinutes: version.durationMinutes,
      trackId: version.trackId,
      speakerIds: version.participants
        .map(({ speakerId }) => speakerId)
        .filter((speakerId) => publishedSpeakerIds.has(speakerId)),
    };
  });
  const roomIds = new Set(event.agendaPlacements.map(({ roomId }) => roomId));
  const trackIds = new Set(
    event.agendaPlacements.flatMap((placement) => [
      ...placement.tracks.map(({ trackId }) => trackId),
      ...(placement.session.versions[0]?.trackId ? [placement.session.versions[0].trackId] : []),
    ]),
  );

  return {
    schemaVersion: 1,
    event: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      websiteUrl: event.websiteUrl,
      location: event.location,
      timezone: event.timezone,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      theme: event.theme,
    },
    rooms: event.rooms.filter(({ id }) => roomIds.has(id)).map(({ id, name, sortOrder }) => ({ id, name, sortOrder })),
    tracks: event.tracks
      .filter(({ id }) => trackIds.has(id))
      .map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder })),
    speakers: publishedSpeakers,
    sessions,
    placements: event.agendaPlacements.map((placement) => ({
      id: placement.id,
      sessionId: placement.sessionId,
      roomId: placement.roomId,
      startsAt: placement.startsAt.toISOString(),
      endsAt: placement.endsAt.toISOString(),
      trackIds: placement.tracks.map(({ trackId }) => trackId),
      speakerIds: placement.speakers
        .map(({ speakerId }) => speakerId)
        .filter((speakerId) => publishedSpeakerIds.has(speakerId)),
    })),
  };
}

export class PublishedProgramRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async publish(input: PublicationInput): Promise<PersistedPublishedProgramVersion> {
    requireExpectedVersion(input.expectedVersion);
    if (input.expectedVersion !== 0) conflict("Initial publication requires expectedVersion 0.");
    return this.createPublishedVersion(input, true);
  }

  async republish(input: PublicationInput): Promise<PersistedPublishedProgramVersion> {
    requireExpectedVersion(input.expectedVersion);
    if (input.expectedVersion === 0) conflict("Republishing requires an existing published-program version.");
    return this.createPublishedVersion(input, false);
  }

  async unpublish(input: PublicationInput): Promise<PersistedPublishedProgramVersion> {
    requireExpectedVersion(input.expectedVersion);
    try {
      return await this.client.$transaction(
        async (transaction) => {
          const program = await transaction.publishedProgram.findUnique({
            where: { eventId: input.eventId },
            include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
          });
          const latest = program?.versions[0];
          if (!program || !latest) throw new RepositoryError("not-found", "The published program was not found.");
          if (latest.versionNumber !== input.expectedVersion) {
            conflict("The published program changed. Reload it before unpublishing.");
          }
          if (latest.state !== PublishedProgramState.PUBLISHED)
            conflict("The published program is already unpublished.");
          const created = await transaction.publishedProgramVersion.create({
            data: {
              eventId: input.eventId,
              publishedProgramId: program.id,
              versionNumber: latest.versionNumber + 1,
              state: PublishedProgramState.UNPUBLISHED,
              actorPrincipalId: input.actorPrincipalId,
            },
          });
          return fromStored(created);
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async latest(eventId: string): Promise<PersistedPublishedProgramVersion | null> {
    const latest = await this.client.publishedProgramVersion.findFirst({
      where: { eventId },
      orderBy: { versionNumber: "desc" },
    });
    return latest ? fromStored(latest) : null;
  }

  async listVersions(eventId: string): Promise<PersistedPublishedProgramVersion[]> {
    const versions = await this.client.publishedProgramVersion.findMany({
      where: { eventId },
      orderBy: { versionNumber: "asc" },
    });
    return versions.map(fromStored);
  }

  private async createPublishedVersion(
    input: PublicationInput,
    initial: boolean,
  ): Promise<PersistedPublishedProgramVersion> {
    try {
      return await this.client.$transaction(
        async (transaction) => {
          const event = await transaction.event.findUnique({
            where: { id: input.eventId },
            select: snapshotEventSelect,
          });
          if (!event) throw new RepositoryError("not-found", "The event was not found.");
          const existing = await transaction.publishedProgram.findUnique({
            where: { eventId: input.eventId },
            include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
          });
          const latest = existing?.versions[0];
          if (initial && existing) conflict("The event already has a published-program history. Use republish.");
          if (!initial && (!existing || !latest)) {
            throw new RepositoryError("not-found", "The published program was not found.");
          }
          if ((latest?.versionNumber ?? 0) !== input.expectedVersion) {
            conflict("The published program changed. Reload it before publishing again.");
          }
          const program = existing ?? (await transaction.publishedProgram.create({ data: { eventId: input.eventId } }));
          const created = await transaction.publishedProgramVersion.create({
            data: {
              eventId: input.eventId,
              publishedProgramId: program.id,
              versionNumber: input.expectedVersion + 1,
              state: PublishedProgramState.PUBLISHED,
              actorPrincipalId: input.actorPrincipalId,
              snapshot: buildSnapshot(event) as unknown as Prisma.InputJsonValue,
            },
          });
          return fromStored(created);
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
