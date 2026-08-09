import { Prisma, type PrismaClient, type SpeakerTaskAssignmentStatus } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { normalizeSpeakerTaskResponse } from "./task-responses.ts";

export interface SpeakerTaskDefinitionInput {
  readonly sortOrder: number;
  readonly title: string;
  readonly description?: string | null;
  readonly applicability: Prisma.InputJsonValue;
  readonly defaultDueOffsetDays?: number | null;
  readonly responseRequired?: boolean;
  readonly responseSchema?: Prisma.InputJsonValue;
}

export interface CreateSpeakerTaskDefinitionInput extends SpeakerTaskDefinitionInput {
  readonly eventId: string;
  readonly key: string;
}

export interface AssignSpeakerTaskInput {
  readonly eventId: string;
  readonly definitionId: string;
  readonly speakerId: string;
  readonly dueAt?: Date | null;
}

export interface ListSpeakerTaskDefinitionsOptions {
  readonly includeArchived?: boolean;
}

export interface AssignSpeakerTaskCohortInput {
  readonly eventId: string;
  readonly definitionId: string;
  readonly speakerIds: readonly string[];
  readonly dueAt?: Date | null;
}

export interface SpeakerTaskCohortResult {
  readonly assignments: readonly PersistedSpeakerTaskAssignment[];
  readonly skippedActiveSpeakerIds: readonly string[];
}

const definitionInclude = {
  versions: { orderBy: { versionNumber: "asc" } },
} as const satisfies Prisma.SpeakerTaskDefinitionInclude;

const assignmentInclude = {
  definitionVersion: true,
  submissions: { orderBy: { attemptNumber: "asc" } },
  transitions: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.SpeakerTaskAssignmentInclude;

export type PersistedSpeakerTaskDefinition = Prisma.SpeakerTaskDefinitionGetPayload<{
  include: typeof definitionInclude;
}>;
export type PersistedSpeakerTaskAssignment = Prisma.SpeakerTaskAssignmentGetPayload<{
  include: typeof assignmentInclude;
}>;

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

// An explicit null due date is distinct from an absent one: it opts out of the
// definition's default offset rather than falling back to it.
function resolveDueAt(dueAt: Date | null | undefined, defaultDueOffsetDays: number | null, assignedAt: Date) {
  if (dueAt !== undefined) return dueAt;
  if (defaultDueOffsetDays === null) return null;
  return new Date(assignedAt.getTime() + defaultDueOffsetDays * 86_400_000);
}

function validateDefinition(input: SpeakerTaskDefinitionInput) {
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) invalid("sortOrder must be a nonnegative integer.");
  if (
    input.defaultDueOffsetDays !== undefined &&
    input.defaultDueOffsetDays !== null &&
    (!Number.isInteger(input.defaultDueOffsetDays) || input.defaultDueOffsetDays < 0)
  ) {
    invalid("defaultDueOffsetDays must be a nonnegative integer.");
  }
  const responseRequired = input.responseRequired ?? false;
  if (responseRequired && input.responseSchema === undefined) {
    invalid("responseSchema is required when a response is required.");
  }
  return {
    sortOrder: input.sortOrder,
    title: requiredText(input.title, "title"),
    description: input.description?.trim() || null,
    applicability: input.applicability,
    defaultDueOffsetDays: input.defaultDueOffsetDays ?? null,
    responseRequired,
    responseSchema: input.responseSchema,
  };
}

function requiresConfirmedSpeaker(applicability: Prisma.JsonValue): boolean {
  return (
    typeof applicability === "object" &&
    applicability !== null &&
    !Array.isArray(applicability) &&
    applicability.confirmedOnly === true
  );
}

async function requireEligibleSpeakers(
  transaction: Prisma.TransactionClient,
  eventId: string,
  speakerIds: readonly string[],
  applicability: Prisma.JsonValue,
): Promise<void> {
  const uniqueSpeakerIds = [...new Set(speakerIds)];
  if (uniqueSpeakerIds.length === 0) invalid("At least one speaker is required.");

  const eligibleStatuses = requiresConfirmedSpeaker(applicability)
    ? ["CONFIRMED" as const]
    : ["ACCEPTED" as const, "CONFIRMED" as const];
  const speakers = await transaction.speaker.findMany({
    where: {
      eventId,
      id: { in: uniqueSpeakerIds },
    },
    select: {
      id: true,
      submissions: {
        where: { submission: { eventId, status: { in: eligibleStatuses } } },
        select: { speakerId: true },
        take: 1,
      },
    },
  });
  if (speakers.length !== uniqueSpeakerIds.length) {
    throw new RepositoryError("not-found", "An event-owned speaker was not found.");
  }
  if (speakers.some(({ submissions }) => submissions.length === 0)) {
    invalid(
      requiresConfirmedSpeaker(applicability)
        ? "Every selected speaker must have a confirmed submission for this task."
        : "Every selected speaker must have an accepted submission for this task.",
    );
  }
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") throw new RepositoryError("conflict", "The task definition or assignment already exists.");
    if (code === "P2003") {
      throw new RepositoryError("conflict", "Task definitions and speakers with assignment history cannot be deleted.");
    }
    if (code === "P2025") throw new RepositoryError("not-found", "The event-owned onboarding record was not found.");
  }
  throw error;
}

export class SpeakerOnboardingRepository {
  private readonly client: PrismaClient;
  private readonly now: () => Date;

  constructor(client: PrismaClient, now: () => Date = () => new Date()) {
    this.client = client;
    this.now = now;
  }

  async createDefinition(input: CreateSpeakerTaskDefinitionInput): Promise<PersistedSpeakerTaskDefinition> {
    const definition = validateDefinition(input);
    try {
      return await this.client.speakerTaskDefinition.create({
        data: {
          eventId: input.eventId,
          key: requiredText(input.key, "key"),
          versions: { create: { versionNumber: 1, ...definition } },
        },
        include: definitionInclude,
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async createDefinitionVersion(
    eventId: string,
    definitionId: string,
    input: SpeakerTaskDefinitionInput,
  ): Promise<PersistedSpeakerTaskDefinition> {
    const definition = validateDefinition(input);
    try {
      await this.client.$transaction(async (transaction) => {
        const current = await transaction.speakerTaskDefinition.findFirst({
          where: { eventId, id: definitionId },
          include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        });
        const latest = current?.versions[0];
        if (!latest) throw new RepositoryError("not-found", "The event-owned task definition was not found.");
        await transaction.speakerTaskDefinitionVersion.create({
          data: { eventId, definitionId, versionNumber: latest.versionNumber + 1, ...definition },
        });
      });
      return await this.requireDefinition(eventId, definitionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async listDefinitions(
    eventId: string,
    options: ListSpeakerTaskDefinitionsOptions = {},
  ): Promise<PersistedSpeakerTaskDefinition[]> {
    const definitions = await this.client.speakerTaskDefinition.findMany({
      where: { eventId, ...(options.includeArchived ? {} : { archivedAt: null }) },
      include: definitionInclude,
    });
    return definitions.sort((left, right) => {
      const leftVersion = left.versions.at(-1);
      const rightVersion = right.versions.at(-1);
      return (leftVersion?.sortOrder ?? 0) - (rightVersion?.sortOrder ?? 0) || left.key.localeCompare(right.key);
    });
  }

  async getDefinition(eventId: string, definitionId: string): Promise<PersistedSpeakerTaskDefinition | null> {
    return this.client.speakerTaskDefinition.findFirst({
      where: { eventId, id: definitionId },
      include: definitionInclude,
    });
  }

  async reorderDefinitions(eventId: string, orderedIds: readonly string[]): Promise<PersistedSpeakerTaskDefinition[]> {
    try {
      const current = await this.listDefinitions(eventId);
      const currentIds = new Set(current.map(({ id }) => id));
      if (
        orderedIds.length !== current.length ||
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.some((id) => !currentIds.has(id))
      ) {
        invalid("orderedIds must contain every active event-owned task definition exactly once.");
      }

      const byId = new Map(current.map((definition) => [definition.id, definition]));
      await this.client.$transaction(async (transaction) => {
        for (const [sortOrder, definitionId] of orderedIds.entries()) {
          const definition = byId.get(definitionId);
          const latest = definition?.versions.at(-1);
          if (!latest) throw new RepositoryError("not-found", "The event-owned task definition was not found.");
          if (latest.sortOrder === sortOrder) continue;
          await transaction.speakerTaskDefinitionVersion.create({
            data: {
              eventId,
              definitionId,
              versionNumber: latest.versionNumber + 1,
              sortOrder,
              title: latest.title,
              description: latest.description,
              applicability: latest.applicability as Prisma.InputJsonValue,
              defaultDueOffsetDays: latest.defaultDueOffsetDays,
              responseRequired: latest.responseRequired,
              responseSchema: latest.responseSchema === null ? Prisma.DbNull : latest.responseSchema,
            },
          });
        }
      });
      return this.listDefinitions(eventId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async archiveDefinition(eventId: string, definitionId: string): Promise<PersistedSpeakerTaskDefinition> {
    try {
      const result = await this.client.speakerTaskDefinition.updateMany({
        where: { eventId, id: definitionId, archivedAt: null },
        data: { archivedAt: this.now() },
      });
      if (result.count === 0) {
        throw new RepositoryError("not-found", "The active event-owned task definition was not found.");
      }
      return await this.requireDefinition(eventId, definitionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async duplicateDefinition(
    eventId: string,
    definitionId: string,
    key: string,
  ): Promise<PersistedSpeakerTaskDefinition> {
    const source = await this.getDefinition(eventId, definitionId);
    const latest = source?.versions.at(-1);
    if (!source || !latest) {
      throw new RepositoryError("not-found", "The event-owned task definition was not found.");
    }
    return this.createDefinition({
      eventId,
      key,
      sortOrder: (await this.listDefinitions(eventId)).length,
      title: `${latest.title} copy`,
      description: latest.description,
      applicability: latest.applicability as Prisma.InputJsonValue,
      defaultDueOffsetDays: latest.defaultDueOffsetDays,
      responseRequired: latest.responseRequired,
      responseSchema: latest.responseSchema ?? undefined,
    });
  }

  async assign(input: AssignSpeakerTaskInput): Promise<PersistedSpeakerTaskAssignment> {
    const assignedAt = this.now();
    try {
      const assignment = await this.client.$transaction(async (transaction) => {
        const definition = await transaction.speakerTaskDefinition.findFirst({
          where: { eventId: input.eventId, id: input.definitionId },
          include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        });
        const version = definition?.versions[0];
        if (!version) throw new RepositoryError("not-found", "The event-owned task definition was not found.");
        await requireEligibleSpeakers(transaction, input.eventId, [input.speakerId], version.applicability);
        const dueAt = resolveDueAt(input.dueAt, version.defaultDueOffsetDays, assignedAt);
        if (dueAt !== null && (!Number.isFinite(dueAt.getTime()) || dueAt < assignedAt)) {
          invalid("dueAt must be a valid date on or after assignedAt.");
        }
        return transaction.speakerTaskAssignment.create({
          data: {
            eventId: input.eventId,
            definitionId: input.definitionId,
            definitionVersionId: version.id,
            speakerId: input.speakerId,
            assignedAt,
            dueAt,
            transitions: { create: { toStatus: "PENDING", occurredAt: assignedAt } },
          },
        });
      });
      return await this.requireAssignment(input.eventId, assignment.id);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async assignCohort(input: AssignSpeakerTaskCohortInput): Promise<SpeakerTaskCohortResult> {
    const assignedAt = this.now();
    const speakerIds = [...new Set(input.speakerIds)];
    try {
      const result = await this.client.$transaction(async (transaction) => {
        const definition = await transaction.speakerTaskDefinition.findFirst({
          where: { eventId: input.eventId, id: input.definitionId },
          include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        });
        const version = definition?.versions[0];
        if (!version) throw new RepositoryError("not-found", "The event-owned task definition was not found.");
        await requireEligibleSpeakers(transaction, input.eventId, speakerIds, version.applicability);

        const dueAt = resolveDueAt(input.dueAt, version.defaultDueOffsetDays, assignedAt);
        if (dueAt !== null && (!Number.isFinite(dueAt.getTime()) || dueAt < assignedAt)) {
          invalid("dueAt must be a valid date on or after assignedAt.");
        }

        const active = await transaction.speakerTaskAssignment.findMany({
          where: {
            eventId: input.eventId,
            definitionId: input.definitionId,
            speakerId: { in: speakerIds },
            status: { not: "WITHDRAWN" },
          },
          select: { speakerId: true },
        });
        const skippedActiveSpeakerIds = active.map(({ speakerId }) => speakerId);
        const skipped = new Set(skippedActiveSpeakerIds);
        const createdIds: string[] = [];
        for (const speakerId of speakerIds) {
          if (skipped.has(speakerId)) continue;
          const assignment = await transaction.speakerTaskAssignment.create({
            data: {
              eventId: input.eventId,
              definitionId: input.definitionId,
              definitionVersionId: version.id,
              speakerId,
              assignedAt,
              dueAt,
              transitions: { create: { toStatus: "PENDING", occurredAt: assignedAt } },
            },
            select: { id: true },
          });
          createdIds.push(assignment.id);
        }
        return { createdIds, skippedActiveSpeakerIds };
      });
      const assignments = await this.client.speakerTaskAssignment.findMany({
        where: { eventId: input.eventId, id: { in: result.createdIds } },
        include: assignmentInclude,
        orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
      });
      return { assignments, skippedActiveSpeakerIds: result.skippedActiveSpeakerIds };
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async updateDueDate(
    eventId: string,
    assignmentId: string,
    dueAt: Date | null,
  ): Promise<PersistedSpeakerTaskAssignment> {
    try {
      const assignment = await this.client.speakerTaskAssignment.findFirst({ where: { eventId, id: assignmentId } });
      if (!assignment) throw new RepositoryError("not-found", "The event-owned task assignment was not found.");
      if (assignment.status === "APPROVED" || assignment.status === "WITHDRAWN") {
        invalid("Completed or withdrawn assignments cannot have their due date changed.");
      }
      if (dueAt !== null && (!Number.isFinite(dueAt.getTime()) || dueAt < assignment.assignedAt)) {
        invalid("dueAt must be a valid date on or after assignedAt.");
      }
      await this.client.speakerTaskAssignment.update({ where: { id: assignmentId }, data: { dueAt } });
      return await this.requireAssignment(eventId, assignmentId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async submit(
    eventId: string,
    assignmentId: string,
    response?: Prisma.InputJsonValue,
    speakerId?: string,
  ): Promise<PersistedSpeakerTaskAssignment> {
    const occurredAt = this.now();
    try {
      await this.client.$transaction(async (transaction) => {
        const assignment = await transaction.speakerTaskAssignment.findFirst({
          where: { eventId, id: assignmentId, ...(speakerId ? { speakerId } : {}) },
          include: {
            definitionVersion: true,
            submissions: { orderBy: { attemptNumber: "desc" }, take: 1 },
            transitions: { where: { toStatus: "SUBMITTED" }, select: { id: true } },
          },
        });
        if (!assignment) throw new RepositoryError("not-found", "The event-owned task assignment was not found.");
        if (assignment.status === "SUBMITTED") return;
        if (assignment.status !== "PENDING" && assignment.status !== "REVISION_REQUESTED") {
          invalid("Only pending or revision-requested assignments can be submitted.");
        }
        const normalizedResponse = normalizeSpeakerTaskResponse(
          assignment.definitionVersion.responseRequired,
          assignment.definitionVersion.responseSchema,
          response,
        );
        const claimed = await transaction.speakerTaskAssignment.updateMany({
          where: { id: assignmentId, status: assignment.status },
          data: { status: "SUBMITTED", submittedAt: occurredAt },
        });
        if (claimed.count === 0) return;
        const latest = assignment.submissions[0];
        const hasDraft = assignment.transitions.length < (latest?.attemptNumber ?? 0);
        if (latest && hasDraft) {
          await transaction.speakerTaskSubmission.update({
            where: { id: latest.id },
            data: { response: normalizedResponse, submittedAt: occurredAt },
          });
        } else {
          await transaction.speakerTaskSubmission.create({
            data: {
              assignmentId,
              attemptNumber: (latest?.attemptNumber ?? 0) + 1,
              response: normalizedResponse,
              submittedAt: occurredAt,
            },
          });
        }
        await transaction.speakerTaskAssignmentTransition.create({
          data: { assignmentId, fromStatus: assignment.status, toStatus: "SUBMITTED", occurredAt },
        });
      });
      return await this.requireAssignment(eventId, assignmentId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async saveDraft(
    eventId: string,
    assignmentId: string,
    response: Prisma.InputJsonValue,
    speakerId?: string,
  ): Promise<PersistedSpeakerTaskAssignment> {
    const occurredAt = this.now();
    try {
      await this.client.$transaction(async (transaction) => {
        const assignment = await transaction.speakerTaskAssignment.findFirst({
          where: { eventId, id: assignmentId, ...(speakerId ? { speakerId } : {}) },
          include: {
            submissions: { orderBy: { attemptNumber: "desc" }, take: 1 },
            transitions: { where: { toStatus: "SUBMITTED" }, select: { id: true } },
          },
        });
        if (!assignment) throw new RepositoryError("not-found", "The event-owned task assignment was not found.");
        if (assignment.status !== "PENDING" && assignment.status !== "REVISION_REQUESTED") {
          invalid("Only pending or revision-requested assignments can save a draft.");
        }
        const latest = assignment.submissions[0];
        const hasDraft = assignment.transitions.length < (latest?.attemptNumber ?? 0);
        if (latest && hasDraft) {
          await transaction.speakerTaskSubmission.update({ where: { id: latest.id }, data: { response } });
        } else {
          await transaction.speakerTaskSubmission.create({
            data: {
              assignmentId,
              attemptNumber: (latest?.attemptNumber ?? 0) + 1,
              response,
              submittedAt: occurredAt,
            },
          });
        }
      });
      return await this.requireAssignment(eventId, assignmentId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async review(
    eventId: string,
    assignmentId: string,
    decision: Extract<SpeakerTaskAssignmentStatus, "APPROVED" | "REVISION_REQUESTED">,
    note?: string,
  ): Promise<PersistedSpeakerTaskAssignment> {
    const occurredAt = this.now();
    try {
      const assignment = await this.client.speakerTaskAssignment.findFirst({ where: { eventId, id: assignmentId } });
      if (!assignment) throw new RepositoryError("not-found", "The event-owned task assignment was not found.");
      if (assignment.status !== "SUBMITTED") invalid("Only submitted assignments can be reviewed.");
      await this.client.speakerTaskAssignment.update({
        where: { id: assignmentId },
        data: {
          status: decision,
          completedAt: decision === "APPROVED" ? occurredAt : null,
          transitions: {
            create: { fromStatus: "SUBMITTED", toStatus: decision, note: note?.trim() || null, occurredAt },
          },
        },
      });
      return await this.requireAssignment(eventId, assignmentId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async withdraw(eventId: string, assignmentId: string, note?: string): Promise<PersistedSpeakerTaskAssignment> {
    const occurredAt = this.now();
    try {
      const assignment = await this.client.speakerTaskAssignment.findFirst({ where: { eventId, id: assignmentId } });
      if (!assignment) throw new RepositoryError("not-found", "The event-owned task assignment was not found.");
      if (assignment.status === "APPROVED" || assignment.status === "WITHDRAWN") {
        invalid("Approved or already-withdrawn assignments cannot be withdrawn.");
      }
      await this.client.speakerTaskAssignment.update({
        where: { id: assignmentId },
        data: {
          status: "WITHDRAWN",
          withdrawnAt: occurredAt,
          transitions: {
            create: { fromStatus: assignment.status, toStatus: "WITHDRAWN", note: note?.trim() || null, occurredAt },
          },
        },
      });
      return await this.requireAssignment(eventId, assignmentId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async getAssignment(eventId: string, assignmentId: string): Promise<PersistedSpeakerTaskAssignment | null> {
    return this.client.speakerTaskAssignment.findFirst({
      where: { eventId, id: assignmentId },
      include: assignmentInclude,
    });
  }

  private async requireDefinition(eventId: string, definitionId: string): Promise<PersistedSpeakerTaskDefinition> {
    const definition = await this.client.speakerTaskDefinition.findFirst({
      where: { eventId, id: definitionId },
      include: definitionInclude,
    });
    if (!definition) throw new RepositoryError("not-found", "The event-owned task definition was not found.");
    return definition;
  }

  private async requireAssignment(eventId: string, assignmentId: string): Promise<PersistedSpeakerTaskAssignment> {
    const assignment = await this.getAssignment(eventId, assignmentId);
    if (!assignment) throw new RepositoryError("not-found", "The event-owned task assignment was not found.");
    return assignment;
  }
}
