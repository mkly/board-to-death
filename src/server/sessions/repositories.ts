import {
  CfpSubmissionKind,
  CfpSubmissionStatus,
  type Prisma,
  type PrismaClient,
  ProgramSessionKind,
  ProgramSessionParticipantRole,
} from "../../generated/prisma/client.ts";
import { parseCfpDefinition } from "../../lib/cfp/index.ts";
import { boundedLimit, collectPages, LIST_BOUNDS, type ListPage, toListPage } from "../database/list-bounds.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface ListProgramSessionsOptions {
  readonly includeArchived?: boolean;
  readonly ids?: readonly string[];
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface ProgramSessionVersionInput {
  readonly title: string;
  readonly description?: string | null;
  readonly durationMinutes: number;
  readonly categoryId?: string | null;
  readonly trackId?: string | null;
  readonly speakerIds?: readonly string[];
  readonly participants?: readonly ProgramSessionParticipantInput[];
  readonly parentSessionId?: string | null;
}

export interface ProgramSessionParticipantInput {
  readonly speakerId: string;
  readonly role: ProgramSessionParticipantRole;
}

export interface PromoteProgramSessionInput {
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
  readonly parentSessionId?: string | null;
}

export interface PersistedProgramSessionVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly categoryId: string | null;
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
  readonly parentSessionId: string | null;
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

export const MAX_SUBSESSIONS_PER_PARENT = 20;

interface ValidatedVersion {
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly categoryId: string | null;
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
    categoryId: input.categoryId ?? null,
    trackId: input.trackId ?? null,
    participants,
  };
}

async function requireVersionReferences(
  transaction: Prisma.TransactionClient,
  eventId: string,
  version: ValidatedVersion,
): Promise<void> {
  const [event, speakerCount, categoryCount, trackCount] = await Promise.all([
    transaction.event.findUnique({ where: { id: eventId }, select: { id: true, archivedAt: true } }),
    transaction.speaker.count({
      where: { eventId, id: { in: version.participants.map(({ speakerId }) => speakerId) } },
    }),
    version.categoryId === null
      ? Promise.resolve(1)
      : transaction.cfpCategory.count({ where: { eventId, id: version.categoryId } }),
    version.trackId === null
      ? Promise.resolve(1)
      : transaction.track.count({ where: { eventId, id: version.trackId } }),
  ]);
  if (!event) throw new RepositoryError("not-found", "The event was not found.");
  if (event.archivedAt !== null) invalid("An archived event is read-only. Restore it before editing.");
  if (speakerCount !== version.participants.length) {
    throw new RepositoryError("not-found", "Every participant must be a speaker in the session event.");
  }
  if (categoryCount !== 1) throw new RepositoryError("not-found", "The event-owned category was not found.");
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
    categoryId: version.categoryId,
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
    parentSessionId: stored.parentSessionId,
    archivedAt: stored.archivedAt,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    version,
    versions,
  };
}

const titleQuestionIds = new Set(["title", "proposal-title", "session-title", "talk-title"]);
const titleQuestionLabels = new Set(["title", "proposal title", "session title", "talk title"]);
const descriptionQuestionIds = new Set(["abstract", "description", "proposal-description", "session-description"]);
const descriptionQuestionLabels = new Set(["abstract", "description", "proposal description", "session description"]);

function normalizedLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ");
}

function snapshotAnswer(
  revision: {
    readonly definitionSnapshot: Prisma.JsonValue;
    readonly answers: readonly { readonly questionId: string; readonly value: Prisma.JsonValue }[];
  },
  questionIds: ReadonlySet<string>,
  labels: ReadonlySet<string>,
): string | null {
  const definition = parseCfpDefinition(revision.definitionSnapshot);
  if (!definition.ok) invalid("The stored submission definition snapshot is invalid.");
  const matchingQuestion = definition.definition.sections
    .flatMap(({ questions }) => questions)
    .find(({ id, label }) => questionIds.has(id) || labels.has(normalizedLabel(label)));
  const answer = revision.answers.find(({ questionId }) => questionId === matchingQuestion?.id)?.value;
  return typeof answer === "string" && answer.trim() !== "" ? answer.trim() : null;
}

async function createVersion(
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
      categoryId: version.categoryId,
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

async function promoteSubmission(
  transaction: Prisma.TransactionClient,
  eventId: string,
  sourceSubmissionId: string,
  optional: boolean,
): Promise<string | null> {
  const unpromotable = (message: string): null => {
    if (optional) return null;
    invalid(message);
  };

  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`program-session-promotion:${sourceSubmissionId}`}))`;

  const existing = await transaction.programSession.findFirst({
    where: { eventId, sourceSubmissionId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const source = await transaction.cfpSubmission.findFirst({
    where: { eventId, id: sourceSubmissionId },
    select: {
      id: true,
      kind: true,
      status: true,
      categories: { orderBy: { sortOrder: "asc" }, take: 1, select: { categoryId: true } },
      participants: { orderBy: { sortOrder: "asc" }, select: { speakerId: true } },
      revisions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          definitionSnapshot: true,
          answers: { orderBy: { sortOrder: "asc" }, select: { questionId: true, value: true } },
        },
      },
    },
  });
  if (!source) throw new RepositoryError("not-found", "The event-owned source submission was not found.");
  if (source.kind !== CfpSubmissionKind.ABSTRACT) return unpromotable("Only an abstract submission can be promoted.");
  if (source.status !== CfpSubmissionStatus.ACCEPTED) {
    return unpromotable("Only an accepted submission can be promoted.");
  }
  const revision = source.revisions[0];
  if (!revision) return unpromotable("The accepted submission does not have a revision to promote.");
  const title = snapshotAnswer(revision, titleQuestionIds, titleQuestionLabels);
  if (!title) return unpromotable("The accepted submission does not have a title answer to promote.");
  const version = validateVersion({
    title,
    description: snapshotAnswer(revision, descriptionQuestionIds, descriptionQuestionLabels),
    durationMinutes: 45,
    categoryId: source.categories[0]?.categoryId,
    speakerIds: source.participants.map(({ speakerId }) => speakerId),
  });
  await requireVersionReferences(transaction, eventId, version);
  const session = await transaction.programSession.create({
    data: { eventId, kind: ProgramSessionKind.PROMOTED, sourceSubmissionId: source.id },
    select: { id: true },
  });
  await createVersion(transaction, eventId, session.id, 1, version);
  return session.id;
}

export async function promoteAcceptedSubmission(
  transaction: Prisma.TransactionClient,
  eventId: string,
  sourceSubmissionId: string,
): Promise<string> {
  const sessionId = await promoteSubmission(transaction, eventId, sourceSubmissionId, false);
  if (sessionId === null) invalid("The submission could not be promoted into a session.");
  return sessionId;
}

/**
 * Promotes the submission when it is eligible and returns null when it is not, so recording an
 * acceptance never fails over a submission that simply cannot become a session.
 */
export async function promoteAcceptedSubmissionIfPromotable(
  transaction: Prisma.TransactionClient,
  eventId: string,
  sourceSubmissionId: string,
): Promise<string | null> {
  return promoteSubmission(transaction, eventId, sourceSubmissionId, true);
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
      const sessionId = await this.client.$transaction((transaction) =>
        promoteAcceptedSubmission(transaction, input.eventId, input.sourceSubmissionId),
      );
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
        const parentSessionId = input.parentSessionId === undefined ? current.parentSessionId : input.parentSessionId;
        await this.requireParent(transaction, eventId, sessionId, parentSessionId);
        const version = validateVersion({
          title: input.title ?? previous.title,
          description: input.description === undefined ? previous.description : input.description,
          durationMinutes: input.durationMinutes ?? previous.durationMinutes,
          categoryId: previous.categoryId,
          trackId: input.trackId === undefined ? previous.trackId : input.trackId,
          ...participantInput,
        });
        await requireVersionReferences(transaction, eventId, version);
        if (parentSessionId !== current.parentSessionId) {
          await transaction.programSession.update({
            where: { eventId_id: { eventId, id: sessionId } },
            data: { parentSessionId },
          });
        }
        await createVersion(transaction, eventId, sessionId, previous.versionNumber + 1, version);
        if (parentSessionId)
          await this.attachParticipantsToParent(transaction, eventId, parentSessionId, version.participants);
      });
      return await this.require(eventId, sessionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async clone(eventId: string, sessionId: string): Promise<PersistedProgramSession> {
    try {
      const clonedId = await this.client.$transaction(async (transaction) => {
        const source = await transaction.programSession.findFirst({
          where: { eventId, id: sessionId },
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              include: { participants: { orderBy: { sortOrder: "asc" } } },
            },
          },
        });
        const sourceVersion = source?.versions[0];
        if (!source || !sourceVersion) {
          throw new RepositoryError("not-found", "The event-owned session was not found.");
        }
        const version = validateVersion({
          title: `${sourceVersion.title} (copy)`,
          description: sourceVersion.description,
          durationMinutes: sourceVersion.durationMinutes,
          categoryId: sourceVersion.categoryId,
          trackId: sourceVersion.trackId,
          participants: sourceVersion.participants.map(({ speakerId, role }) => ({ speakerId, role })),
        });
        await requireVersionReferences(transaction, eventId, version);
        const clone = await transaction.programSession.create({
          data: { eventId, kind: ProgramSessionKind.MANUAL },
          select: { id: true },
        });
        await createVersion(transaction, eventId, clone.id, 1, version);
        return clone.id;
      });
      return await this.require(eventId, clonedId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async archive(eventId: string, sessionId: string, archivedAt: Date = new Date()): Promise<PersistedProgramSession> {
    if (!Number.isFinite(archivedAt.getTime())) invalid("archivedAt must be a valid date.");
    const activeSubsessions = await this.client.programSession.count({
      where: { eventId, parentSessionId: sessionId, archivedAt: null },
    });
    if (activeSubsessions > 0) invalid("Move or archive this session's subsessions before archiving it.");
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
      where: {
        eventId,
        ...(options.includeArchived ? {} : { archivedAt: null }),
        ...(options.ids ? { id: { in: [...options.ids] } } : {}),
      },
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
        await this.requireParent(transaction, input.eventId, null, input.parentSessionId ?? null);
        const session = await transaction.programSession.create({
          data: { eventId: input.eventId, kind, parentSessionId: input.parentSessionId ?? null },
          select: { id: true },
        });
        await createVersion(transaction, input.eventId, session.id, 1, version);
        if (input.parentSessionId) {
          await this.attachParticipantsToParent(
            transaction,
            input.eventId,
            input.parentSessionId,
            version.participants,
          );
        }
        return session.id;
      });
      return await this.require(input.eventId, sessionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  private async requireParent(
    transaction: Prisma.TransactionClient,
    eventId: string,
    sessionId: string | null,
    parentSessionId: string | null,
  ): Promise<void> {
    if (!parentSessionId) return;
    if (parentSessionId === sessionId) invalid("A session cannot be its own parent.");
    const [parent, childCount, hasChildren] = await Promise.all([
      transaction.programSession.findFirst({
        where: { eventId, id: parentSessionId, archivedAt: null },
        select: { id: true, parentSessionId: true, agendaPlacement: { select: { startsAt: true, endsAt: true } } },
      }),
      transaction.programSession.count({
        where: { eventId, parentSessionId, archivedAt: null, ...(sessionId ? { id: { not: sessionId } } : {}) },
      }),
      sessionId
        ? transaction.programSession.count({ where: { eventId, parentSessionId: sessionId, archivedAt: null } })
        : Promise.resolve(0),
    ]);
    if (!parent) throw new RepositoryError("not-found", "The active event-owned parent session was not found.");
    if (parent.parentSessionId) invalid("Subsessions cannot contain nested subsessions.");
    if (hasChildren > 0) invalid("A session with subsessions cannot become a subsession.");
    if (childCount >= MAX_SUBSESSIONS_PER_PARENT) {
      invalid(`A parent session can contain at most ${MAX_SUBSESSIONS_PER_PARENT} subsessions.`);
    }
    if (sessionId) {
      const childPlacement = await transaction.agendaPlacement.findFirst({
        where: { eventId, sessionId },
        select: { startsAt: true, endsAt: true },
      });
      if (childPlacement && !parent.agendaPlacement) {
        invalid("Schedule the parent session before converting a placed session to a subsession.");
      }
      if (
        childPlacement &&
        parent.agendaPlacement &&
        (childPlacement.startsAt < parent.agendaPlacement.startsAt ||
          childPlacement.endsAt > parent.agendaPlacement.endsAt)
      ) {
        invalid("The existing placement must fit inside the parent session window.");
      }
    }
  }

  private async attachParticipantsToParent(
    transaction: Prisma.TransactionClient,
    eventId: string,
    parentSessionId: string,
    participants: readonly ProgramSessionParticipantInput[],
  ): Promise<void> {
    if (participants.length === 0) return;
    const parent = await transaction.programSession.findFirst({
      where: { eventId, id: parentSessionId, archivedAt: null },
      select: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { participants: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });
    const previous = parent?.versions[0];
    if (!previous) throw new RepositoryError("not-found", "The active parent session has no version.");
    const merged = previous.participants.map(({ speakerId, role }) => ({ speakerId, role }));
    for (const participant of participants) {
      if (!merged.some(({ speakerId }) => speakerId === participant.speakerId)) merged.push({ ...participant });
    }
    if (merged.length === previous.participants.length) return;
    await createVersion(transaction, eventId, parentSessionId, previous.versionNumber + 1, {
      title: previous.title,
      description: previous.description,
      durationMinutes: previous.durationMinutes,
      categoryId: previous.categoryId,
      trackId: previous.trackId,
      participants: merged,
    });
  }

  private async require(eventId: string, sessionId: string): Promise<PersistedProgramSession> {
    const session = await this.get(eventId, sessionId);
    if (!session) throw new RepositoryError("not-found", "The event-owned session was not found.");
    return session;
  }
}
