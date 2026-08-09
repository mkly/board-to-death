import {
  CfpSubmissionKind,
  type Prisma,
  type PrismaClient,
  ProgramSessionKind,
  ProgramSessionParticipantRole,
} from "../../generated/prisma/client.ts";
import { boundedLimit, collectPages, LIST_BOUNDS, type ListPage, toListPage } from "../database/list-bounds.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface ListProgramSessionsOptions {
  readonly includeArchived?: boolean;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface ProgramSessionVersionInput {
  readonly title: string;
  readonly description?: string | null;
  readonly durationMinutes: number;
  readonly trackId?: string | null;
  readonly speakerIds?: readonly string[];
  readonly participants?: readonly ProgramSessionParticipantInput[];
}

export interface ProgramSessionParticipantInput {
  readonly speakerId: string;
  readonly role: ProgramSessionParticipantRole;
}

export interface PromoteProgramSessionInput extends ProgramSessionVersionInput {
  readonly eventId: string;
  readonly sourceSubmissionId: string;
}

export interface CreateProgramSessionInput extends ProgramSessionVersionInput {
  readonly eventId: string;
}

export interface UpdateProgramSessionInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly durationMinutes?: number;
  readonly trackId?: string | null;
  readonly speakerIds?: readonly string[];
  readonly participants?: readonly ProgramSessionParticipantInput[];
}

export interface PersistedProgramSessionVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly trackId: string | null;
  readonly speakerIds: readonly string[];
  readonly participants: readonly ProgramSessionParticipantInput[];
  readonly createdAt: Date;
}

export interface PersistedProgramSession {
  readonly id: string;
  readonly eventId: string;
  readonly kind: ProgramSessionKind;
  readonly sourceSubmissionId: string | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: PersistedProgramSessionVersion;
  readonly versions: readonly PersistedProgramSessionVersion[];
}

const programSessionInclude = {
  versions: {
    orderBy: { versionNumber: "asc" },
    include: { participants: { orderBy: { sortOrder: "asc" } } },
  },
} as const satisfies Prisma.ProgramSessionInclude;

type StoredProgramSession = Prisma.ProgramSessionGetPayload<{ include: typeof programSessionInclude }>;

interface ValidatedVersion {
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly trackId: string | null;
  readonly participants: readonly ProgramSessionParticipantInput[];
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function validateVersion(input: ProgramSessionVersionInput): ValidatedVersion {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    invalid("durationMinutes must be a positive integer.");
  }
  if (input.speakerIds !== undefined && input.participants !== undefined) {
    invalid("Provide participants or speakerIds, not both.");
  }
  const participants = input.participants
    ? input.participants.map((participant) => ({ ...participant }))
    : (input.speakerIds ?? []).map((speakerId) => ({ speakerId, role: ProgramSessionParticipantRole.SPEAKER }));
  if (participants.some(({ role }) => !Object.values(ProgramSessionParticipantRole).includes(role))) {
    invalid("Every participant role must be supported.");
  }
  const speakerIds = participants.map(({ speakerId }) => speakerId);
  if (new Set(speakerIds).size !== speakerIds.length) {
    invalid("participants must contain each speaker at most once.");
  }
  return {
    title: requiredText(input.title, "title"),
    description: optionalText(input.description),
    durationMinutes: input.durationMinutes,
    trackId: input.trackId ?? null,
    participants,
  };
}

async function requireVersionReferences(
  transaction: Prisma.TransactionClient,
  eventId: string,
  version: ValidatedVersion,
): Promise<void> {
  const [event, speakerCount, trackCount] = await Promise.all([
    transaction.event.findUnique({ where: { id: eventId }, select: { id: true } }),
    transaction.speaker.count({
      where: { eventId, id: { in: version.participants.map(({ speakerId }) => speakerId) } },
    }),
    version.trackId === null
      ? Promise.resolve(1)
      : transaction.track.count({ where: { eventId, id: version.trackId } }),
  ]);
  if (!event) throw new RepositoryError("not-found", "The event was not found.");
  if (speakerCount !== version.participants.length) {
    throw new RepositoryError("not-found", "Every participant must be a speaker in the session event.");
  }
  if (trackCount !== 1) throw new RepositoryError("not-found", "The event-owned track was not found.");
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError("conflict", "The source submission, version, or participant order already exists.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned session reference was not found.");
    }
  }
  throw error;
}

function fromStored(stored: StoredProgramSession): PersistedProgramSession {
  const versions = stored.versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    title: version.title,
    description: version.description,
    durationMinutes: version.durationMinutes,
    trackId: version.trackId,
    speakerIds: version.participants.map(({ speakerId }) => speakerId),
    participants: version.participants.map(({ speakerId, role }) => ({ speakerId, role })),
    createdAt: version.createdAt,
  }));
  const version = versions.at(-1);
  if (!version) throw new Error(`Program session ${stored.id} has no version.`);
  return {
    id: stored.id,
    eventId: stored.eventId,
    kind: stored.kind,
    sourceSubmissionId: stored.sourceSubmissionId,
    archivedAt: stored.archivedAt,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    version,
    versions,
  };
}

export class ProgramSessionRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async createManual(input: CreateProgramSessionInput): Promise<PersistedProgramSession> {
    return this.create(ProgramSessionKind.MANUAL, input);
  }

  async createGuaranteed(input: CreateProgramSessionInput): Promise<PersistedProgramSession> {
    return this.create(ProgramSessionKind.GUARANTEED, input);
  }

  async promote(input: PromoteProgramSessionInput): Promise<PersistedProgramSession> {
    try {
      const version = validateVersion(input);
      const sessionId = await this.client.$transaction(async (transaction) => {
        const source = await transaction.cfpSubmission.findFirst({
          where: { eventId: input.eventId, id: input.sourceSubmissionId },
          select: { id: true, kind: true },
        });
        if (!source) throw new RepositoryError("not-found", "The event-owned source submission was not found.");
        if (source.kind !== CfpSubmissionKind.ABSTRACT) invalid("Only an abstract submission can be promoted.");
        await requireVersionReferences(transaction, input.eventId, version);
        const session = await transaction.programSession.create({
          data: {
            eventId: input.eventId,
            kind: ProgramSessionKind.PROMOTED,
            sourceSubmissionId: source.id,
          },
          select: { id: true },
        });
        await this.createVersion(transaction, input.eventId, session.id, 1, version);
        return session.id;
      });
      return await this.require(input.eventId, sessionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async update(eventId: string, sessionId: string, input: UpdateProgramSessionInput): Promise<PersistedProgramSession> {
    try {
      await this.client.$transaction(async (transaction) => {
        const current = await transaction.programSession.findFirst({
          where: { eventId, id: sessionId },
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              include: { participants: { orderBy: { sortOrder: "asc" } } },
            },
          },
        });
        const previous = current?.versions[0];
        if (!current || !previous) throw new RepositoryError("not-found", "The event-owned session was not found.");
        if (current.archivedAt !== null) invalid("An archived session cannot be edited.");
        let participantInput: Pick<ProgramSessionVersionInput, "participants" | "speakerIds"> = {
          participants: previous.participants.map(({ speakerId, role }) => ({ speakerId, role })),
        };
        if (input.participants !== undefined) participantInput = { participants: input.participants };
        else if (input.speakerIds !== undefined) participantInput = { speakerIds: input.speakerIds };
        const version = validateVersion({
          title: input.title ?? previous.title,
          description: input.description === undefined ? previous.description : input.description,
          durationMinutes: input.durationMinutes ?? previous.durationMinutes,
          trackId: input.trackId === undefined ? previous.trackId : input.trackId,
          ...participantInput,
        });
        await requireVersionReferences(transaction, eventId, version);
        await this.createVersion(transaction, eventId, sessionId, previous.versionNumber + 1, version);
      });
      return await this.require(eventId, sessionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async archive(eventId: string, sessionId: string, archivedAt: Date = new Date()): Promise<PersistedProgramSession> {
    if (!Number.isFinite(archivedAt.getTime())) invalid("archivedAt must be a valid date.");
    const updated = await this.client.programSession.updateMany({
      where: { eventId, id: sessionId },
      data: { archivedAt },
    });
    if (updated.count === 0) throw new RepositoryError("not-found", "The event-owned session was not found.");
    return this.require(eventId, sessionId);
  }

  async get(eventId: string, sessionId: string): Promise<PersistedProgramSession | null> {
    const session = await this.client.programSession.findFirst({
      where: { eventId, id: sessionId },
      include: programSessionInclude,
    });
    return session ? fromStored(session) : null;
  }

  /**
   * One bounded page of an event's sessions, newest cursor last.
   *
   * Interactive screens read a single page so their cost does not follow the
   * event's session count; `list` walks every page for the callers that need the
   * whole program.
   */
  async listPage(
    eventId: string,
    options: ListProgramSessionsOptions = {},
  ): Promise<ListPage<PersistedProgramSession>> {
    const limit = boundedLimit(options.limit, LIST_BOUNDS.programSessions);
    const sessions = await this.client.programSession.findMany({
      where: { eventId, ...(options.includeArchived ? {} : { archivedAt: null }) },
      include: programSessionInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    return toListPage(sessions.map(fromStored), limit, (session) => session.id);
  }

  async list(
    eventId: string,
    options: { readonly includeArchived?: boolean } = {},
  ): Promise<PersistedProgramSession[]> {
    return collectPages((cursor, take) => this.listPage(eventId, { ...options, cursor, limit: take }));
  }

  private async create(
    kind: Exclude<ProgramSessionKind, "PROMOTED">,
    input: CreateProgramSessionInput,
  ): Promise<PersistedProgramSession> {
    try {
      const version = validateVersion(input);
      const sessionId = await this.client.$transaction(async (transaction) => {
        await requireVersionReferences(transaction, input.eventId, version);
        const session = await transaction.programSession.create({
          data: { eventId: input.eventId, kind },
          select: { id: true },
        });
        await this.createVersion(transaction, input.eventId, session.id, 1, version);
        return session.id;
      });
      return await this.require(input.eventId, sessionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  private async createVersion(
    transaction: Prisma.TransactionClient,
    eventId: string,
    sessionId: string,
    versionNumber: number,
    version: ValidatedVersion,
  ): Promise<void> {
    const created = await transaction.programSessionVersion.create({
      data: {
        eventId,
        sessionId,
        versionNumber,
        title: version.title,
        description: version.description,
        durationMinutes: version.durationMinutes,
        trackId: version.trackId,
      },
      select: { id: true },
    });
    if (version.participants.length > 0) {
      await transaction.programSessionParticipant.createMany({
        data: version.participants.map(({ speakerId, role }, sortOrder) => ({
          eventId,
          sessionVersionId: created.id,
          speakerId,
          role,
          sortOrder,
        })),
      });
    }
  }

  private async require(eventId: string, sessionId: string): Promise<PersistedProgramSession> {
    const session = await this.get(eventId, sessionId);
    if (!session) throw new RepositoryError("not-found", "The event-owned session was not found.");
    return session;
  }
}
