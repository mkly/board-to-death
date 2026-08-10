import {
  type Event,
  type EventType,
  Prisma,
  type PrismaClient,
  type Room,
  type Track,
} from "../../generated/prisma/client.ts";

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
  readonly orgId?: string;
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

export type UpdateEventInput = Partial<Omit<CreateEventInput, "orgId">>;

export interface CloneEventOptions {
  readonly rooms: boolean;
  readonly tracks: boolean;
  readonly forms: boolean;
  readonly tasks: boolean;
  readonly templates: boolean;
  readonly portalSettings: boolean;
}

export interface CloneEventInput {
  readonly name: string;
  readonly slug: string;
  readonly options: CloneEventOptions;
}

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

function inputJson(value: Prisma.JsonValue): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return value === null ? Prisma.JsonNull : value;
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
    orgId: input.orgId,
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
  const event = await client.event.findUnique({ where: { id: eventId }, select: { id: true, archivedAt: true } });
  if (!event) {
    throw new RepositoryError("not-found", "The event was not found.");
  }
  if (event.archivedAt !== null) {
    throw new RepositoryError("invalid-input", "An archived event is read-only. Restore it before editing.");
  }
}

async function cloneForms(
  transaction: Prisma.TransactionClient,
  sourceEventId: string,
  destinationEventId: string,
): Promise<void> {
  const forms = await transaction.cfpForm.findMany({
    where: { eventId: sourceEventId },
    include: {
      versions: {
        orderBy: { versionNumber: "asc" },
        include: {
          steps: { orderBy: { sortOrder: "asc" }, include: { questions: { orderBy: { sortOrder: "asc" } } } },
        },
      },
    },
  });
  for (const form of forms) {
    const created = await transaction.cfpForm.create({ data: { eventId: destinationEventId, key: form.key } });
    for (const version of form.versions) {
      await transaction.cfpFormVersion.create({
        data: {
          formId: created.id,
          versionNumber: version.versionNumber,
          schemaVersion: version.schemaVersion,
          title: version.title,
          description: version.description,
          submissionKind: version.submissionKind,
          accessPolicy: version.accessPolicy,
          welcomeTitle: version.welcomeTitle,
          welcomeContent: version.welcomeContent,
          instructions: version.instructions,
          termsContent: version.termsContent,
          consentRequired: version.consentRequired,
          minimumSpeakerCount: version.minimumSpeakerCount,
          maximumSpeakerCount: version.maximumSpeakerCount,
          requiredSpeakerFields: version.requiredSpeakerFields ?? undefined,
          customTypes: inputJson(version.customTypes),
          categories: version.categories ?? undefined,
          categoryRules: version.categoryRules ?? undefined,
          steps: {
            create: version.steps.map((step) => ({
              key: step.key,
              kind: step.kind,
              title: step.title,
              description: step.description,
              sortOrder: step.sortOrder,
              questions: {
                create: step.questions.map((question) => ({
                  key: question.key,
                  type: question.type,
                  label: question.label,
                  description: question.description,
                  required: question.required,
                  constraints: question.constraints ?? undefined,
                  visibleWhen: question.visibleWhen ?? undefined,
                  sortOrder: question.sortOrder,
                })),
              },
            })),
          },
        },
      });
    }
  }
}

async function cloneTasks(
  transaction: Prisma.TransactionClient,
  sourceEventId: string,
  destinationEventId: string,
): Promise<void> {
  const definitions = await transaction.speakerTaskDefinition.findMany({
    where: { eventId: sourceEventId },
    include: { versions: { orderBy: { versionNumber: "asc" } } },
  });
  for (const definition of definitions) {
    const created = await transaction.speakerTaskDefinition.create({
      data: { eventId: destinationEventId, key: definition.key, archivedAt: definition.archivedAt },
    });
    if (definition.versions.length > 0) {
      await transaction.speakerTaskDefinitionVersion.createMany({
        data: definition.versions.map((version) => ({
          eventId: destinationEventId,
          definitionId: created.id,
          versionNumber: version.versionNumber,
          sortOrder: version.sortOrder,
          title: version.title,
          description: version.description,
          applicability: inputJson(version.applicability),
          defaultDueOffsetDays: version.defaultDueOffsetDays,
          responseRequired: version.responseRequired,
          responseSchema: version.responseSchema ?? undefined,
        })),
      });
    }
  }
}

async function cloneTemplates(
  transaction: Prisma.TransactionClient,
  sourceEventId: string,
  destinationEventId: string,
): Promise<void> {
  const templates = await transaction.communicationTemplate.findMany({
    where: { eventId: sourceEventId },
    include: { versions: { orderBy: { version: "asc" } } },
  });
  for (const template of templates) {
    const created = await transaction.communicationTemplate.create({
      data: { eventId: destinationEventId, key: template.key, name: template.name },
    });
    if (template.versions.length > 0) {
      await transaction.communicationTemplateVersion.createMany({
        data: template.versions.map((version) => ({
          eventId: destinationEventId,
          templateId: created.id,
          version: version.version,
          subjectTemplate: version.subjectTemplate,
          htmlTemplate: version.htmlTemplate,
          textTemplate: version.textTemplate,
        })),
      });
    }
  }
}

async function cloneResourcePages(
  transaction: Prisma.TransactionClient,
  sourceEventId: string,
  destinationEventId: string,
): Promise<void> {
  const pages = await transaction.speakerResourcePage.findMany({
    where: { eventId: sourceEventId },
    include: { versions: { orderBy: { versionNumber: "asc" } } },
  });
  for (const page of pages) {
    const created = await transaction.speakerResourcePage.create({
      data: { eventId: destinationEventId, key: page.key, archivedAt: page.archivedAt },
    });
    if (page.versions.length > 0) {
      await transaction.speakerResourcePageVersion.createMany({
        data: page.versions.map((version) => ({
          eventId: destinationEventId,
          pageId: created.id,
          versionNumber: version.versionNumber,
          slug: version.slug,
          title: version.title,
          summary: version.summary,
          bodyMarkdown: version.bodyMarkdown,
          allowedEmbedUrls: version.allowedEmbedUrls ?? undefined,
          sortOrder: version.sortOrder,
          publishedAt: version.publishedAt,
          unpublishedAt: version.unpublishedAt,
        })),
      });
    }
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

  async countForOrg(orgId: string): Promise<number> {
    return this.client.event.count({ where: { orgId } });
  }

  async update(id: string, input: UpdateEventInput): Promise<Event> {
    const current = await this.get(id);
    if (!current) {
      throw new RepositoryError("not-found", "The event was not found.");
    }
    if (current.archivedAt !== null) {
      throw new RepositoryError("invalid-input", "An archived event is read-only. Restore it before editing.");
    }
    const validated = validateEvent({ ...current, ...input });
    try {
      return await this.client.event.update({ where: { id }, data: validated });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async clone(sourceEventId: string, input: CloneEventInput): Promise<Event> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const source = await transaction.event.findUnique({ where: { id: sourceEventId } });
        if (!source) throw new RepositoryError("not-found", "The source event was not found.");

        const validated = validateEvent({
          name: input.name,
          slug: input.slug,
          type: source.type,
          websiteUrl: source.websiteUrl,
          location: source.location,
          timezone: source.timezone,
          startsAt: source.startsAt,
          endsAt: source.endsAt,
          theme: input.options.portalSettings ? source.theme : null,
          exhibitorsEnabled: source.exhibitorsEnabled,
          sponsorsEnabled: source.sponsorsEnabled,
          logoObjectKey: input.options.portalSettings ? source.logoObjectKey : null,
          backgroundObjectKey: input.options.portalSettings ? source.backgroundObjectKey : null,
        });
        const clone = await transaction.event.create({
          data: { ...validated, orgId: source.orgId, clonedFromEventId: source.id },
        });

        if (input.options.rooms) {
          const rooms = await transaction.room.findMany({
            where: { eventId: source.id },
            orderBy: { sortOrder: "asc" },
          });
          if (rooms.length > 0) {
            await transaction.room.createMany({
              data: rooms.map(({ name, sortOrder }) => ({ eventId: clone.id, name, sortOrder })),
            });
          }
        }

        if (input.options.tracks) {
          const tracks = await transaction.track.findMany({
            where: { eventId: source.id },
            orderBy: { sortOrder: "asc" },
          });
          if (tracks.length > 0) {
            await transaction.track.createMany({
              data: tracks.map(({ name, color, sortOrder }) => ({ eventId: clone.id, name, color, sortOrder })),
            });
          }
        }

        if (input.options.forms) await cloneForms(transaction, source.id, clone.id);
        if (input.options.tasks) await cloneTasks(transaction, source.id, clone.id);
        if (input.options.templates) await cloneTemplates(transaction, source.id, clone.id);
        if (input.options.portalSettings) await cloneResourcePages(transaction, source.id, clone.id);

        return clone;
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async archive(id: string, archivedAt: Date = new Date()): Promise<Event> {
    if (!Number.isFinite(archivedAt.getTime())) invalid("archivedAt must be a valid date.");
    try {
      return await this.client.event.update({ where: { id }, data: { archivedAt } });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async restore(id: string): Promise<Event> {
    try {
      return await this.client.event.update({ where: { id }, data: { archivedAt: null } });
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
