import {
  type CustomFieldDefinition,
  type CustomFieldEntityType,
  CustomFieldType,
  type CustomFieldValue,
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface CustomFieldDefinitionInput {
  readonly entityType: CustomFieldEntityType;
  readonly key: string;
  readonly label: string;
  readonly description?: string | null;
  readonly type: CustomFieldType;
  readonly required?: boolean;
  readonly characterLimit?: number | null;
  readonly options?: readonly string[] | null;
}

export type CustomFieldDefinitionUpdate = Partial<Omit<CustomFieldDefinitionInput, "entityType">>;

export type CustomFieldTarget =
  | { readonly entityType: "CONTACT"; readonly contactId: string }
  | { readonly entityType: "PROGRAM_SESSION"; readonly sessionId: string }
  | { readonly entityType: "CONTACT_GROUP"; readonly groupId: string }
  | { readonly entityType: "CFP_SUBMISSION"; readonly submissionId: string };

export type CustomFieldInputValue = string | number | boolean | readonly string[] | CustomFieldFileValue;

export interface CustomFieldFileValue {
  readonly objectKey: string;
  readonly fileName: string;
}

export interface CustomFieldValueFilter {
  readonly definitionId: string;
  readonly query: string;
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function text(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeKey(value: string): string {
  const key = text(value, "key")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) invalid("key must contain at least one letter or number.");
  return key;
}

function normalizedOptions(type: CustomFieldType, options: readonly string[] | null | undefined): string[] | null {
  const supportsOptions = type === CustomFieldType.SINGLE_SELECT || type === CustomFieldType.MULTI_SELECT;
  if (!supportsOptions) {
    if (options?.length) invalid("Only select fields can define options.");
    return null;
  }
  const normalized = (options ?? []).map((option) => text(option, "option"));
  if (normalized.length === 0) invalid("Select fields require at least one option.");
  if (new Set(normalized).size !== normalized.length) invalid("Select field options must be unique.");
  return normalized;
}

function normalizedLimit(type: CustomFieldType, limit: number | null | undefined): number | null {
  const supportsLimit =
    type === CustomFieldType.SINGLE_LINE_TEXT || type === CustomFieldType.LONG_TEXT || type === CustomFieldType.URL;
  if (!supportsLimit) {
    if (limit !== undefined && limit !== null) invalid("This field type does not support a character limit.");
    return null;
  }
  if (limit === undefined || limit === null) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) invalid("characterLimit must be from 1 to 100,000.");
  return limit;
}

function definitionData(input: CustomFieldDefinitionInput) {
  return {
    entityType: input.entityType,
    key: normalizeKey(input.key),
    label: text(input.label, "label"),
    description: optionalText(input.description),
    type: input.type,
    required: input.required ?? false,
    characterLimit: normalizedLimit(input.type, input.characterLimit),
    options: normalizedOptions(input.type, input.options) ?? Prisma.DbNull,
  };
}

function optionsFor(definition: CustomFieldDefinition): readonly string[] {
  if (!Array.isArray(definition.options) || !definition.options.every((option) => typeof option === "string")) {
    return [];
  }
  return definition.options;
}

function validateValue(definition: CustomFieldDefinition, input: CustomFieldInputValue): Prisma.InputJsonValue {
  if (definition.type === CustomFieldType.CHECKBOX) {
    if (typeof input !== "boolean") invalid(`${definition.label} must be checked or unchecked.`);
    if (definition.required && !input) invalid(`${definition.label} must be checked.`);
    return input;
  }
  if (definition.type === CustomFieldType.NUMBER) {
    if (typeof input !== "number" || !Number.isFinite(input)) invalid(`${definition.label} must be a number.`);
    return input;
  }
  if (definition.type === CustomFieldType.MULTI_SELECT) {
    if (!Array.isArray(input) || !input.every((value) => typeof value === "string")) {
      invalid(`${definition.label} must contain selected options.`);
    }
    const selected = [...new Set(input.map((value) => value.trim()).filter(Boolean))];
    if (definition.required && selected.length === 0) invalid(`${definition.label} requires at least one selection.`);
    const allowed = new Set(optionsFor(definition));
    if (selected.some((value) => !allowed.has(value))) invalid(`${definition.label} contains an unavailable option.`);
    return selected;
  }
  if (definition.type === CustomFieldType.FILE) {
    if (typeof input !== "object" || input === null || Array.isArray(input) || !("objectKey" in input)) {
      invalid(`${definition.label} must be an uploaded file.`);
    }
    const file = input as CustomFieldFileValue;
    return { objectKey: text(file.objectKey, "objectKey"), fileName: text(file.fileName, "fileName") };
  }
  if (typeof input !== "string") invalid(`${definition.label} must be text.`);
  const value = input.trim();
  if (definition.required && value === "") invalid(`${definition.label} is required.`);
  if (definition.characterLimit !== null && value.length > definition.characterLimit) {
    invalid(`${definition.label} cannot exceed ${definition.characterLimit} characters.`);
  }
  if (definition.type === CustomFieldType.DATE && value !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      invalid(`${definition.label} must be a valid date.`);
    }
  }
  if (definition.type === CustomFieldType.URL && value !== "") {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") invalid(`${definition.label} must use HTTP or HTTPS.`);
    } catch {
      invalid(`${definition.label} must be a valid URL.`);
    }
  }
  if (definition.type === CustomFieldType.SINGLE_SELECT && value !== "" && !optionsFor(definition).includes(value)) {
    invalid(`${definition.label} contains an unavailable option.`);
  }
  return value;
}

function normalizeForSearch(value: Prisma.InputJsonValue): string | null {
  if (typeof value === "string") return value.toLocaleLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value).toLocaleLowerCase();
  if (Array.isArray(value)) return value.join("\n").toLocaleLowerCase();
  if (value && typeof value === "object" && "fileName" in value && typeof value.fileName === "string") {
    return value.fileName.toLocaleLowerCase();
  }
  return null;
}

function targetWhere(eventId: string, target: CustomFieldTarget) {
  if (target.entityType === "CONTACT") return { eventId, contactId: target.contactId };
  if (target.entityType === "PROGRAM_SESSION") return { eventId, sessionId: target.sessionId };
  if (target.entityType === "CONTACT_GROUP") return { eventId, groupId: target.groupId };
  return { eventId, submissionId: target.submissionId };
}

function targetData(target: CustomFieldTarget) {
  if (target.entityType === "CONTACT") return { contactId: target.contactId };
  if (target.entityType === "PROGRAM_SESSION") return { sessionId: target.sessionId };
  if (target.entityType === "CONTACT_GROUP") return { groupId: target.groupId };
  return { submissionId: target.submissionId };
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") throw new RepositoryError("conflict", "That custom field key or position is already used.");
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned custom field reference was not found.");
    }
  }
  throw error;
}

export class CustomFieldRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async listDefinitions(
    eventId: string,
    entityType?: CustomFieldEntityType,
  ): Promise<readonly CustomFieldDefinition[]> {
    return this.client.customFieldDefinition.findMany({
      where: { eventId, ...(entityType ? { entityType } : {}) },
      orderBy: [{ entityType: "asc" }, { position: "asc" }],
    });
  }

  async createDefinition(eventId: string, input: CustomFieldDefinitionInput): Promise<CustomFieldDefinition> {
    const data = definitionData(input);
    try {
      return await this.client.$transaction(async (transaction) => {
        const aggregate = await transaction.customFieldDefinition.aggregate({
          where: { eventId, entityType: data.entityType },
          _max: { position: true },
        });
        return transaction.customFieldDefinition.create({
          data: { eventId, ...data, position: (aggregate._max.position ?? -1) + 1 },
        });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async updateDefinition(
    eventId: string,
    definitionId: string,
    input: CustomFieldDefinitionUpdate,
  ): Promise<CustomFieldDefinition> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const current = await transaction.customFieldDefinition.findUnique({
          where: { eventId_id: { eventId, id: definitionId } },
        });
        if (!current) throw new RepositoryError("not-found", "The custom field was not found.");
        const next = definitionData({
          entityType: current.entityType,
          key: input.key ?? current.key,
          label: input.label ?? current.label,
          description: input.description === undefined ? current.description : input.description,
          type: input.type ?? current.type,
          required: input.required ?? current.required,
          characterLimit: input.characterLimit === undefined ? current.characterLimit : input.characterLimit,
          options: input.options === undefined ? optionsFor(current) : input.options,
        });
        if (next.type !== current.type && (await transaction.customFieldValue.count({ where: { definitionId } })) > 0) {
          throw new RepositoryError("conflict", "A field with saved values cannot change type.");
        }
        return transaction.customFieldDefinition.update({
          where: { eventId_id: { eventId, id: definitionId } },
          data: next,
        });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async reorderDefinitions(eventId: string, entityType: CustomFieldEntityType, definitionIds: readonly string[]) {
    try {
      await this.client.$transaction(async (transaction) => {
        const current = await transaction.customFieldDefinition.findMany({
          where: { eventId, entityType },
          select: { id: true },
        });
        if (current.length !== definitionIds.length || current.some(({ id }) => !definitionIds.includes(id))) {
          invalid("The custom field order must include every field in this section exactly once.");
        }
        if (new Set(definitionIds).size !== definitionIds.length)
          invalid("The custom field order contains duplicates.");
        await Promise.all(
          definitionIds.map((id, index) =>
            transaction.customFieldDefinition.update({
              where: { eventId_id: { eventId, id } },
              data: { position: -(index + 1) },
            }),
          ),
        );
        for (const [position, id] of definitionIds.entries()) {
          await transaction.customFieldDefinition.update({
            where: { eventId_id: { eventId, id } },
            data: { position },
          });
        }
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async deleteDefinition(eventId: string, definitionId: string): Promise<void> {
    try {
      await this.client.$transaction(async (transaction) => {
        const definition = await transaction.customFieldDefinition.findUnique({
          where: { eventId_id: { eventId, id: definitionId } },
          select: { id: true },
        });
        if (!definition) throw new RepositoryError("not-found", "The custom field was not found.");
        if ((await transaction.customFieldValue.count({ where: { definitionId } })) > 0) {
          throw new RepositoryError("conflict", "Remove this field's saved values before deleting it.");
        }
        await transaction.customFieldDefinition.delete({ where: { eventId_id: { eventId, id: definitionId } } });
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async listValues(eventId: string, target: CustomFieldTarget): Promise<readonly CustomFieldValue[]> {
    return this.client.customFieldValue.findMany({
      where: targetWhere(eventId, target),
      orderBy: { definition: { position: "asc" } },
    });
  }

  async setValue(
    eventId: string,
    definitionId: string,
    target: CustomFieldTarget,
    input: CustomFieldInputValue,
  ): Promise<CustomFieldValue | null> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const definition = await transaction.customFieldDefinition.findUnique({
          where: { eventId_id: { eventId, id: definitionId } },
        });
        if (!definition || definition.entityType !== target.entityType) {
          throw new RepositoryError("not-found", "The custom field is not available for this record.");
        }
        const value = validateValue(definition, input);
        const where = { definitionId, ...targetWhere(eventId, target) };
        if ((value === "" || (Array.isArray(value) && value.length === 0)) && !definition.required) {
          await transaction.customFieldValue.deleteMany({ where });
          return null;
        }
        const existing = await transaction.customFieldValue.findFirst({ where, select: { id: true } });
        if (existing) {
          return transaction.customFieldValue.update({
            where: { id: existing.id },
            data: { value, normalizedText: normalizeForSearch(value) },
          });
        }
        return transaction.customFieldValue.create({
          data: {
            eventId,
            definitionId,
            ...targetData(target),
            value,
            normalizedText: normalizeForSearch(value),
          },
        });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async matchingTargetIds(eventId: string, filter: CustomFieldValueFilter): Promise<readonly string[]> {
    const definition = await this.client.customFieldDefinition.findUnique({
      where: { eventId_id: { eventId, id: filter.definitionId } },
      select: { entityType: true },
    });
    if (!definition) throw new RepositoryError("not-found", "The custom field was not found.");
    const values = await this.client.customFieldValue.findMany({
      where: {
        eventId,
        definitionId: filter.definitionId,
        normalizedText: { contains: filter.query.trim().toLocaleLowerCase() },
      },
      select: { contactId: true, sessionId: true, groupId: true, submissionId: true },
    });
    return values.flatMap((value) => {
      const id = value.contactId ?? value.sessionId ?? value.groupId ?? value.submissionId;
      return id ? [id] : [];
    });
  }
}
