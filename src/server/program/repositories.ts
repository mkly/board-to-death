import { Prisma, type PrismaClient, type SpeakerResourcePageVersion } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface CreateSpeakerResourceInput {
  readonly eventId: string;
  readonly key: string;
  readonly slug: string;
  readonly title: string;
  readonly summary?: string | null;
  readonly bodyMarkdown: string;
  readonly allowedEmbedUrls?: readonly string[] | null;
}

export interface ReviseSpeakerResourceInput {
  readonly slug?: string;
  readonly title?: string;
  readonly summary?: string | null;
  readonly bodyMarkdown?: string;
  readonly allowedEmbedUrls?: readonly string[] | null;
  readonly sortOrder?: number;
}

export interface PublishedSpeakerResource {
  readonly pageId: string;
  readonly key: string;
  readonly version: SpeakerResourcePageVersion;
}

export type SpeakerResourcePageStatus = "draft" | "published" | "unpublished";

export interface AdminSpeakerResourcePage {
  readonly id: string;
  readonly key: string;
  readonly status: SpeakerResourcePageStatus;
  /** The version the public site serves: the active published one, or the latest when nothing is published. */
  readonly version: SpeakerResourcePageVersion;
  /** A newer unpublished revision saved on top of the published version, when one exists. */
  readonly pendingVersion: SpeakerResourcePageVersion | null;
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

function resourceSlug(value: string): string {
  const normalized = requiredText(value, "slug").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    invalid("slug must contain lowercase letters, numbers, and single hyphens.");
  }
  return normalized;
}

function validDate(value: Date, field: string): Date {
  if (!Number.isFinite(value.getTime())) invalid(`${field} must be a valid date.`);
  return value;
}

function embedData(value: readonly string[] | null | undefined): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return [...value];
}

function storedEmbedData(value: Prisma.JsonValue): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null) return Prisma.DbNull;
  if (!Array.isArray(value)) throw new Error("A stored resource embed allowlist is not an array.");
  return value.map((url) => {
    if (typeof url !== "string") throw new Error("A stored resource embed allowlist contains a non-string value.");
    return url;
  });
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError("conflict", "A speaker resource publication already exists.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned speaker resource record was not found.");
    }
  }
  throw error;
}

export class SpeakerResourceRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async create(input: CreateSpeakerResourceInput) {
    try {
      const key = requiredText(input.key, "key");
      const slug = resourceSlug(input.slug);
      const title = requiredText(input.title, "title");
      const pageId = await this.client.$transaction(async (transaction) => {
        const event = await transaction.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
        if (!event) throw new RepositoryError("not-found", "The event was not found.");
        const last = await transaction.speakerResourcePageVersion.findFirst({
          where: { eventId: input.eventId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        const page = await transaction.speakerResourcePage.create({
          data: { eventId: input.eventId, key },
          select: { id: true },
        });
        await transaction.speakerResourcePageVersion.create({
          data: {
            eventId: input.eventId,
            pageId: page.id,
            versionNumber: 1,
            slug,
            title,
            summary: optionalText(input.summary),
            bodyMarkdown: input.bodyMarkdown,
            sortOrder: (last?.sortOrder ?? -1) + 1,
            ...(embedData(input.allowedEmbedUrls) === undefined
              ? {}
              : { allowedEmbedUrls: embedData(input.allowedEmbedUrls) }),
          },
        });
        return page.id;
      });
      return await this.require(input.eventId, pageId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async revise(eventId: string, pageId: string, input: ReviseSpeakerResourceInput) {
    try {
      await this.client.$transaction(async (transaction) => {
        const page = await transaction.speakerResourcePage.findFirst({
          where: { eventId, id: pageId },
          include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        });
        const previous = page?.versions[0];
        if (!page || !previous) throw new RepositoryError("not-found", "The event-owned resource was not found.");
        if (page.archivedAt !== null) invalid("An archived resource cannot be revised.");
        const sortOrder = input.sortOrder ?? previous.sortOrder;
        if (!Number.isInteger(sortOrder) || sortOrder < 0) invalid("sortOrder must be a non-negative integer.");
        const requestedEmbeds =
          input.allowedEmbedUrls === undefined
            ? storedEmbedData(previous.allowedEmbedUrls)
            : (embedData(input.allowedEmbedUrls) ?? Prisma.DbNull);
        await transaction.speakerResourcePageVersion.create({
          data: {
            eventId,
            pageId,
            versionNumber: previous.versionNumber + 1,
            slug: input.slug === undefined ? previous.slug : resourceSlug(input.slug),
            title: input.title === undefined ? previous.title : requiredText(input.title, "title"),
            summary: input.summary === undefined ? previous.summary : optionalText(input.summary),
            bodyMarkdown: input.bodyMarkdown ?? previous.bodyMarkdown,
            allowedEmbedUrls: requestedEmbeds,
            sortOrder,
          },
        });
      });
      return await this.require(eventId, pageId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async publish(eventId: string, pageId: string, versionId: string, publishedAt: Date = new Date()) {
    validDate(publishedAt, "publishedAt");
    try {
      await this.client.$transaction(async (transaction) => {
        const page = await transaction.speakerResourcePage.findFirst({
          where: { eventId, id: pageId },
          select: { archivedAt: true },
        });
        if (!page) throw new RepositoryError("not-found", "The event-owned resource was not found.");
        if (page.archivedAt !== null) invalid("An archived resource cannot be published.");
        const version = await transaction.speakerResourcePageVersion.findFirst({
          where: { eventId, pageId, id: versionId },
        });
        if (!version) throw new RepositoryError("not-found", "The event-owned resource version was not found.");
        if (version.publishedAt !== null || version.unpublishedAt !== null) {
          invalid("Only a draft resource version can be published.");
        }
        const active = await transaction.speakerResourcePageVersion.findFirst({
          where: { eventId, pageId, publishedAt: { not: null }, unpublishedAt: null },
          select: { publishedAt: true },
        });
        if (active?.publishedAt && publishedAt < active.publishedAt) {
          invalid("publishedAt cannot precede the currently published version's publishedAt.");
        }
        await transaction.speakerResourcePageVersion.updateMany({
          where: { eventId, pageId, publishedAt: { not: null }, unpublishedAt: null },
          data: { unpublishedAt: publishedAt },
        });
        await transaction.speakerResourcePageVersion.update({
          where: { id: versionId },
          data: { publishedAt },
        });
      });
      return await this.require(eventId, pageId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async unpublish(eventId: string, pageId: string, unpublishedAt: Date = new Date()) {
    validDate(unpublishedAt, "unpublishedAt");
    const active = await this.client.speakerResourcePageVersion.findFirst({
      where: { eventId, pageId, publishedAt: { not: null }, unpublishedAt: null },
      select: { id: true, publishedAt: true },
    });
    if (!active) throw new RepositoryError("not-found", "The event-owned published resource was not found.");
    if (active.publishedAt && unpublishedAt < active.publishedAt) invalid("unpublishedAt cannot precede publishedAt.");
    await this.client.speakerResourcePageVersion.update({ where: { id: active.id }, data: { unpublishedAt } });
    return this.require(eventId, pageId);
  }

  async archive(eventId: string, pageId: string, archivedAt: Date = new Date()) {
    validDate(archivedAt, "archivedAt");
    try {
      await this.client.$transaction(async (transaction) => {
        const page = await transaction.speakerResourcePage.findFirst({
          where: { eventId, id: pageId },
          select: { id: true },
        });
        if (!page) throw new RepositoryError("not-found", "The event-owned resource was not found.");
        const active = await transaction.speakerResourcePageVersion.findFirst({
          where: { eventId, pageId, publishedAt: { not: null }, unpublishedAt: null },
          select: { publishedAt: true },
        });
        if (active?.publishedAt && archivedAt < active.publishedAt) invalid("archivedAt cannot precede publishedAt.");
        await transaction.speakerResourcePageVersion.updateMany({
          where: { eventId, pageId, publishedAt: { not: null }, unpublishedAt: null },
          data: { unpublishedAt: archivedAt },
        });
        await transaction.speakerResourcePage.update({ where: { id: pageId }, data: { archivedAt } });
      });
      return await this.require(eventId, pageId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async listPublished(eventId: string): Promise<PublishedSpeakerResource[]> {
    const pages = await this.client.speakerResourcePage.findMany({
      where: {
        eventId,
        archivedAt: null,
        versions: { some: { publishedAt: { not: null }, unpublishedAt: null } },
      },
      select: {
        id: true,
        key: true,
        versions: {
          where: { publishedAt: { not: null }, unpublishedAt: null },
          orderBy: { sortOrder: "asc" },
          take: 1,
        },
      },
    });
    return pages
      .flatMap((page) => {
        const version = page.versions[0];
        return version ? [{ pageId: page.id, key: page.key, version }] : [];
      })
      .sort((first, second) => first.version.sortOrder - second.version.sortOrder);
  }

  async list(eventId: string): Promise<AdminSpeakerResourcePage[]> {
    const pages = await this.client.speakerResourcePage.findMany({
      where: { eventId, archivedAt: null },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
    });
    return pages
      .flatMap((page) => {
        const head = page.versions[0];
        if (!head) return [];
        const active = page.versions.find((version) => version.publishedAt !== null && version.unpublishedAt === null);
        const everPublished = page.versions.some((version) => version.publishedAt !== null);
        let status: SpeakerResourcePageStatus = "draft";
        if (active) status = "published";
        else if (everPublished) status = "unpublished";
        const pendingVersion = active && head.id !== active.id && head.publishedAt === null ? head : null;
        return [{ id: page.id, key: page.key, status, version: active ?? head, pendingVersion }];
      })
      .sort((first, second) => first.version.sortOrder - second.version.sortOrder);
  }

  async reorder(eventId: string, orderedIds: readonly string[]): Promise<AdminSpeakerResourcePage[]> {
    const current = await this.list(eventId);
    const uniqueIds = new Set(orderedIds);
    if (uniqueIds.size !== orderedIds.length || current.length !== orderedIds.length) {
      invalid("orderedIds must contain every event-owned resource exactly once.");
    }
    const currentIds = new Set(current.map(({ id }) => id));
    if (orderedIds.some((id) => !currentIds.has(id))) {
      invalid("orderedIds must contain every event-owned resource exactly once.");
    }
    await this.client.$transaction(
      orderedIds.map((pageId, index) =>
        this.client.speakerResourcePageVersion.updateMany({
          where: { eventId, pageId },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.list(eventId);
  }

  async findPublished(eventId: string, slug: string): Promise<PublishedSpeakerResource | null> {
    const page = await this.client.speakerResourcePage.findFirst({
      where: {
        eventId,
        archivedAt: null,
        versions: { some: { slug, publishedAt: { not: null }, unpublishedAt: null } },
      },
      select: {
        id: true,
        key: true,
        versions: {
          where: { slug, publishedAt: { not: null }, unpublishedAt: null },
          take: 1,
        },
      },
    });
    const version = page?.versions[0];
    return page && version ? { pageId: page.id, key: page.key, version } : null;
  }

  private async require(eventId: string, pageId: string) {
    const page = await this.client.speakerResourcePage.findFirst({
      where: { eventId, id: pageId },
      include: { versions: { orderBy: { versionNumber: "asc" } } },
    });
    if (!page) throw new RepositoryError("not-found", "The event-owned resource was not found.");
    return page;
  }
}
