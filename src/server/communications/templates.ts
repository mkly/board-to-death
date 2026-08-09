import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import {
  type EmailTemplateDefinition,
  type ValidEmailTemplateDefinition,
  validateEmailTemplate,
} from "../../lib/communications/email-templates.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface PersistedEmailTemplate extends ValidEmailTemplateDefinition {
  readonly id: string;
  readonly eventId: string;
  readonly version: number;
  readonly createdAt: Date;
}

export interface CreateEmailTemplateInput extends EmailTemplateDefinition {
  readonly eventId: string;
}

const templateInclude = {
  versions: { orderBy: { version: "desc" }, take: 1 },
} as const satisfies Prisma.CommunicationTemplateInclude;

type StoredTemplate = Prisma.CommunicationTemplateGetPayload<{ include: typeof templateInclude }>;

function validated(input: EmailTemplateDefinition): ValidEmailTemplateDefinition {
  const result = validateEmailTemplate(input);
  if (!result.ok) {
    throw new RepositoryError(
      "invalid-input",
      result.issues.map(({ field, message }) => `${field}: ${message}`).join(" "),
    );
  }
  return result.definition;
}

function fromStored(template: StoredTemplate): PersistedEmailTemplate {
  const version = template.versions[0];
  if (!version) throw new RepositoryError("not-found", "The email template has no stored version.");
  return {
    id: template.id,
    eventId: template.eventId,
    key: template.key,
    name: template.name,
    version: version.version,
    subjectTemplate: version.subjectTemplate,
    bodyTemplate: version.htmlTemplate,
    textTemplate: version.textTemplate,
    createdAt: version.createdAt,
  };
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError("conflict", "An email template with this event key or version already exists.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned email template was not found.");
    }
  }
  throw error;
}

export class EmailTemplateRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async list(eventId: string): Promise<PersistedEmailTemplate[]> {
    const templates = await this.client.communicationTemplate.findMany({
      where: { eventId },
      orderBy: [{ name: "asc" }, { key: "asc" }],
      include: templateInclude,
    });
    return templates.map(fromStored);
  }

  async get(eventId: string, templateId: string): Promise<PersistedEmailTemplate | null> {
    const template = await this.client.communicationTemplate.findFirst({
      where: { id: templateId, eventId },
      include: templateInclude,
    });
    return template ? fromStored(template) : null;
  }

  async create(input: CreateEmailTemplateInput): Promise<PersistedEmailTemplate> {
    const definition = validated(input);
    try {
      const template = await this.client.$transaction(async (transaction) => {
        const event = await transaction.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
        if (!event) throw new RepositoryError("not-found", "The event was not found.");
        return transaction.communicationTemplate.create({
          data: {
            eventId: input.eventId,
            key: definition.key,
            name: definition.name,
            versions: {
              create: {
                version: 1,
                subjectTemplate: definition.subjectTemplate,
                htmlTemplate: definition.bodyTemplate,
                textTemplate: definition.textTemplate,
              },
            },
          },
          include: templateInclude,
        });
      });
      return fromStored(template);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async createVersion(
    eventId: string,
    templateId: string,
    input: EmailTemplateDefinition,
  ): Promise<PersistedEmailTemplate> {
    const definition = validated(input);
    try {
      const template = await this.client.$transaction(async (transaction) => {
        const current = await transaction.communicationTemplate.findFirst({
          where: { id: templateId, eventId },
          include: templateInclude,
        });
        if (!current) throw new RepositoryError("not-found", "The event-owned email template was not found.");
        if (definition.key !== current.key) {
          throw new RepositoryError("invalid-input", "The template key cannot change after creation.");
        }
        const nextVersion = (current.versions[0]?.version ?? 0) + 1;
        await transaction.communicationTemplate.update({
          where: { id: current.id },
          data: { name: definition.name },
        });
        // The version's foreign key is the compound [templateId, eventId], so both scalars are written
        // here rather than nested under the update, where only the template id would be known.
        await transaction.communicationTemplateVersion.create({
          data: {
            templateId: current.id,
            eventId,
            version: nextVersion,
            subjectTemplate: definition.subjectTemplate,
            htmlTemplate: definition.bodyTemplate,
            textTemplate: definition.textTemplate,
          },
        });
        return transaction.communicationTemplate.findUniqueOrThrow({
          where: { id: current.id },
          include: templateInclude,
        });
      });
      return fromStored(template);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
