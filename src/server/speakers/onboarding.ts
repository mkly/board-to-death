import type { Prisma, PrismaClient, SpeakerTaskAssignmentStatus } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

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

  async listDefinitions(eventId: string): Promise<PersistedSpeakerTaskDefinition[]> {
    const definitions = await this.client.speakerTaskDefinition.findMany({
      where: { eventId },
      include: definitionInclude,
    });
    return definitions.sort((left, right) => {
      const leftVersion = left.versions.at(-1);
      const rightVersion = right.versions.at(-1);
      return (leftVersion?.sortOrder ?? 0) - (rightVersion?.sortOrder ?? 0) || left.key.localeCompare(right.key);
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
        const speaker = await transaction.speaker.findFirst({
          where: { eventId: input.eventId, id: input.speakerId },
          select: { id: true },
        });
        if (!speaker) throw new RepositoryError("not-found", "The event-owned speaker was not found.");
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

  async submit(
    eventId: string,
    assignmentId: string,
    response?: Prisma.InputJsonValue,
  ): Promise<PersistedSpeakerTaskAssignment> {
    const occurredAt = this.now();
    try {
      await this.client.$transaction(async (transaction) => {
        const assignment = await transaction.speakerTaskAssignment.findFirst({
          where: { eventId, id: assignmentId },
          include: { definitionVersion: true, submissions: { orderBy: { attemptNumber: "desc" }, take: 1 } },
        });
        if (!assignment) throw new RepositoryError("not-found", "The event-owned task assignment was not found.");
        if (assignment.status !== "PENDING" && assignment.status !== "REVISION_REQUESTED") {
          invalid("Only pending or revision-requested assignments can be submitted.");
        }
        if (assignment.definitionVersion.responseRequired && response === undefined) {
          invalid("This task requires a response.");
        }
        await transaction.speakerTaskSubmission.create({
          data: {
            assignmentId,
            attemptNumber: (assignment.submissions[0]?.attemptNumber ?? 0) + 1,
            response,
            submittedAt: occurredAt,
          },
        });
        await transaction.speakerTaskAssignment.update({
          where: { id: assignmentId },
          data: {
            status: "SUBMITTED",
            submittedAt: occurredAt,
            transitions: { create: { fromStatus: assignment.status, toStatus: "SUBMITTED", occurredAt } },
          },
        });
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
