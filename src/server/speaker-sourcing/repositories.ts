import {
  type Person,
  type Prisma,
  type PrismaClient,
  SpeakerProspectActivityActor,
  SpeakerProspectActivityKind,
  SpeakerProspectStageBehavior,
} from "../../generated/prisma/client.ts";
import { linkDirectoryPersonToEvent } from "../contacts/repositories.ts";
import { RepositoryError } from "../events/repositories.ts";

const DEFAULT_STAGES = [
  { behavior: SpeakerProspectStageBehavior.OPEN, name: "New leads", sortOrder: 0 },
  { behavior: SpeakerProspectStageBehavior.NURTURE, name: "Nurture", sortOrder: 1 },
  { behavior: SpeakerProspectStageBehavior.WON, name: "Booked", sortOrder: 2 },
  { behavior: SpeakerProspectStageBehavior.LOST, name: "Not a fit", sortOrder: 3 },
] as const;

const boardInclude = {
  prospects: {
    orderBy: [{ updatedAt: "desc" }, { createdAt: "asc" }],
    include: {
      person: true,
      assignedEvent: { select: { id: true, name: true, slug: true } },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          fromStage: { select: { id: true, name: true } },
          toStage: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const satisfies Prisma.SpeakerProspectStageInclude;

export type SpeakerSourcingBoardStage = Prisma.SpeakerProspectStageGetPayload<{ include: typeof boardInclude }>;

export interface SpeakerInterestFormInput {
  readonly eventId: string;
  readonly title: string;
  readonly description?: string | null;
}

export interface SpeakerInterestSubmissionInput {
  readonly publicId: string;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organization?: string | null;
  readonly jobTitle?: string | null;
  readonly phone?: string | null;
}

export interface ManualProspectInput {
  readonly eventId: string;
  readonly personId: string;
  readonly actorLabel: string;
}

export interface StageConfigurationInput {
  readonly id: string;
  readonly name: string;
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
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizeEmail(value: string): string {
  const normalized = requiredText(value, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) invalid("email must be a valid address.");
  return normalized;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    if (String(error.code) === "P2003" || String(error.code) === "P2025") {
      throw new RepositoryError("not-found", "The event-owned prospect, form, person, or stage was not found.");
    }
  }
  throw error;
}

async function stageByBehavior(
  transaction: Prisma.TransactionClient,
  eventId: string,
  behavior: SpeakerProspectStageBehavior,
) {
  const stage = await transaction.speakerProspectStage.findUnique({
    where: { eventId_behavior: { eventId, behavior } },
  });
  if (!stage) throw new RepositoryError("not-found", `The ${behavior.toLowerCase()} prospect stage was not found.`);
  return stage;
}

async function createProspectForPerson(
  transaction: Prisma.TransactionClient,
  input: {
    readonly eventId: string;
    readonly personId: string;
    readonly sourceFormId?: string;
    readonly sourceLabel: string;
    readonly actor: SpeakerProspectActivityActor;
    readonly actorLabel: string;
  },
) {
  const openStage = await stageByBehavior(transaction, input.eventId, SpeakerProspectStageBehavior.OPEN);
  return transaction.speakerProspect.upsert({
    where: { eventId_personId: { eventId: input.eventId, personId: input.personId } },
    update: {},
    create: {
      eventId: input.eventId,
      personId: input.personId,
      stageId: openStage.id,
      sourceFormId: input.sourceFormId,
      sourceLabel: input.sourceLabel,
      activities: {
        create: {
          kind: SpeakerProspectActivityKind.CREATED,
          actor: input.actor,
          actorLabel: input.actorLabel,
          toStageId: openStage.id,
        },
      },
    },
    include: { person: true },
  });
}

export class SpeakerSourcingRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async ensureDefaultStages(eventId: string): Promise<void> {
    const event = await this.client.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new RepositoryError("not-found", "The event was not found.");
    await this.client.speakerProspectStage.createMany({
      data: DEFAULT_STAGES.map((stage) => ({ eventId, ...stage })),
      skipDuplicates: true,
    });
  }

  async listBoard(eventId: string): Promise<readonly SpeakerSourcingBoardStage[]> {
    await this.ensureDefaultStages(eventId);
    return this.client.speakerProspectStage.findMany({
      where: { eventId },
      orderBy: { sortOrder: "asc" },
      include: boardInclude,
    });
  }

  async configureStages(eventId: string, stages: readonly StageConfigurationInput[]): Promise<void> {
    if (stages.length !== DEFAULT_STAGES.length || new Set(stages.map(({ id }) => id)).size !== stages.length) {
      invalid("Submit every system stage exactly once.");
    }
    const normalized = stages.map((stage) => ({ id: stage.id, name: requiredText(stage.name, "stage name") }));
    try {
      await this.client.$transaction(async (transaction) => {
        const owned = await transaction.speakerProspectStage.findMany({
          where: { eventId, id: { in: normalized.map(({ id }) => id) } },
          select: { id: true },
        });
        if (owned.length !== DEFAULT_STAGES.length) {
          throw new RepositoryError("not-found", "A selected pipeline stage does not belong to this event.");
        }
        await transaction.speakerProspectStage.updateMany({
          where: { eventId },
          data: { sortOrder: { increment: 100 } },
        });
        await Promise.all(
          normalized.map((stage, sortOrder) =>
            transaction.speakerProspectStage.update({
              where: { eventId_id: { eventId, id: stage.id } },
              data: { name: stage.name, sortOrder },
            }),
          ),
        );
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async createInterestForm(input: SpeakerInterestFormInput) {
    const title = requiredText(input.title, "title");
    try {
      return await this.client.speakerInterestForm.create({
        data: {
          eventId: input.eventId,
          title,
          description: optionalText(input.description),
          publishedAt: new Date(),
        },
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async listInterestForms(eventId: string) {
    return this.client.speakerInterestForm.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "desc" }, { title: "asc" }],
      include: { _count: { select: { prospects: true } } },
    });
  }

  async findPublishedInterestForm(publicId: string) {
    return this.client.speakerInterestForm.findFirst({
      where: { publicId, publishedAt: { not: null } },
      include: { event: { select: { id: true, name: true, slug: true } } },
    });
  }

  async submitInterest(input: SpeakerInterestSubmissionInput) {
    const email = normalizeEmail(input.email);
    const givenName = requiredText(input.givenName, "givenName");
    const familyName = requiredText(input.familyName, "familyName");
    try {
      const publishedForm = await this.client.speakerInterestForm.findFirst({
        where: { publicId: input.publicId, publishedAt: { not: null } },
      });
      if (!publishedForm) throw new RepositoryError("not-found", "This speaker interest form is not available.");
      await this.ensureDefaultStages(publishedForm.eventId);
      return await this.client.$transaction(async (transaction) => {
        const form = await transaction.speakerInterestForm.findFirst({
          where: { id: publishedForm.id, publicId: input.publicId, publishedAt: { not: null } },
        });
        if (!form) throw new RepositoryError("not-found", "This speaker interest form is not available.");
        const person = await transaction.person.upsert({
          where: { email },
          update: {},
          create: {
            email,
            givenName,
            familyName,
            organization: optionalText(input.organization),
            jobTitle: optionalText(input.jobTitle),
            phone: optionalText(input.phone),
          },
        });
        return createProspectForPerson(transaction, {
          eventId: form.eventId,
          personId: person.id,
          sourceFormId: form.id,
          sourceLabel: form.title,
          actor: SpeakerProspectActivityActor.AUTOMATION,
          actorLabel: "Public interest form",
        });
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async enrollManual(input: ManualProspectInput) {
    await this.ensureDefaultStages(input.eventId);
    try {
      return await this.client.$transaction(async (transaction) => {
        const person = await transaction.person.findUnique({ where: { id: input.personId } });
        if (!person) throw new RepositoryError("not-found", "The directory person was not found.");
        return createProspectForPerson(transaction, {
          eventId: input.eventId,
          personId: person.id,
          sourceLabel: "Manual enrollment",
          actor: SpeakerProspectActivityActor.USER,
          actorLabel: requiredText(input.actorLabel, "actorLabel"),
        });
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async moveProspect(eventId: string, prospectId: string, stageId: string, actorLabel: string): Promise<void> {
    try {
      await this.client.$transaction(async (transaction) => {
        const [prospect, stage] = await Promise.all([
          transaction.speakerProspect.findUnique({ where: { eventId_id: { eventId, id: prospectId } } }),
          transaction.speakerProspectStage.findUnique({ where: { eventId_id: { eventId, id: stageId } } }),
        ]);
        if (!prospect || !stage) throw new RepositoryError("not-found", "The prospect or stage was not found.");
        if (prospect.stageId === stage.id) return;
        await transaction.speakerProspect.update({
          where: { eventId_id: { eventId, id: prospect.id } },
          data: {
            stageId: stage.id,
            activities: {
              create: {
                kind: SpeakerProspectActivityKind.STAGE_CHANGED,
                actor: SpeakerProspectActivityActor.USER,
                actorLabel: requiredText(actorLabel, "actorLabel"),
                fromStageId: prospect.stageId,
                toStageId: stage.id,
              },
            },
          },
        });
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async addNote(eventId: string, prospectId: string, note: string, actorLabel: string): Promise<void> {
    const normalized = requiredText(note, "note");
    if (normalized.length > 2_000) invalid("note must be 2,000 characters or fewer.");
    try {
      await this.client.speakerProspectActivity.create({
        data: {
          eventId,
          prospectId,
          kind: SpeakerProspectActivityKind.NOTE_ADDED,
          actor: SpeakerProspectActivityActor.USER,
          actorLabel: requiredText(actorLabel, "actorLabel"),
          note: normalized,
        },
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async assignToEvent(eventId: string, prospectId: string, actorLabel: string): Promise<Person> {
    await this.ensureDefaultStages(eventId);
    try {
      return await this.client.$transaction(async (transaction) => {
        const prospect = await transaction.speakerProspect.findUnique({
          where: { eventId_id: { eventId, id: prospectId } },
          include: { person: true },
        });
        if (!prospect) throw new RepositoryError("not-found", "The prospect was not found.");
        await linkDirectoryPersonToEvent(transaction, eventId, prospect.personId);
        const wonStage = await stageByBehavior(transaction, eventId, SpeakerProspectStageBehavior.WON);
        if (prospect.assignedEventId === null || prospect.stageId !== wonStage.id) {
          await transaction.speakerProspect.update({
            where: { eventId_id: { eventId, id: prospect.id } },
            data: {
              assignedEventId: eventId,
              assignedAt: prospect.assignedAt ?? new Date(),
              stageId: wonStage.id,
              activities: {
                create: {
                  kind: SpeakerProspectActivityKind.ASSIGNED_TO_EVENT,
                  actor: SpeakerProspectActivityActor.USER,
                  actorLabel: requiredText(actorLabel, "actorLabel"),
                  fromStageId: prospect.stageId,
                  toStageId: wonStage.id,
                  note: "Added to the event contact directory.",
                },
              },
            },
          });
        }
        return prospect.person;
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }
}
