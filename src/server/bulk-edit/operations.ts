import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { ProgramSessionRepository } from "../sessions/repositories.ts";

export const BULK_EDIT_FIELDS = {
  CONTACT: ["organization", "jobTitle", "phone"],
  SESSION: ["description", "durationMinutes", "trackId"],
  GROUP: ["name"],
} as const;

export type BulkEditEntityType = keyof typeof BULK_EDIT_FIELDS;
export type BulkEditField = (typeof BULK_EDIT_FIELDS)[BulkEditEntityType][number];

export interface BulkEditInput {
  readonly eventId: string;
  readonly entityType: BulkEditEntityType;
  readonly recordIds: readonly string[];
  readonly field: BulkEditField;
  readonly value: string;
  readonly performedBy: string;
}

export interface BulkEditFailure {
  readonly recordId: string;
  readonly message: string;
}

export interface BulkEditResult {
  readonly operationId: string;
  readonly requestedCount: number;
  readonly succeededCount: number;
  readonly failures: readonly BulkEditFailure[];
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function normalizedValue(entityType: BulkEditEntityType, field: BulkEditField, value: string): string {
  if (!(BULK_EDIT_FIELDS[entityType] as readonly string[]).includes(field)) {
    invalid("The selected field is not available for this record type.");
  }
  const normalized = value.trim();
  if (entityType === "GROUP" && field === "name" && normalized === "") invalid("Group name is required.");
  if (entityType === "SESSION" && field === "durationMinutes") {
    const duration = Number(normalized);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1_440) {
      invalid("Session duration must be a whole number from 1 to 1,440.");
    }
  }
  return normalized;
}

function failureMessage(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  return "The record could not be updated.";
}

export class BulkEditOperationRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async apply(input: BulkEditInput): Promise<BulkEditResult> {
    const recordIds = [...new Set(input.recordIds)];
    if (recordIds.length === 0) invalid("Select at least one record.");
    if (recordIds.length > 100) invalid("Bulk edits are limited to 100 records at a time.");
    const value = normalizedValue(input.entityType, input.field, input.value);
    const operation = await this.client.bulkEditOperation.create({
      data: {
        eventId: input.eventId,
        entityType: input.entityType,
        field: input.field,
        value,
        requestedCount: recordIds.length,
        failureDetails: [],
        performedBy: input.performedBy,
      },
      select: { id: true },
    });

    const failures: BulkEditFailure[] = [];
    let succeededCount = 0;
    for (const recordId of recordIds) {
      try {
        await this.applyToRecord(input.eventId, input.entityType, recordId, input.field, value);
        succeededCount += 1;
      } catch (error) {
        failures.push({ recordId, message: failureMessage(error) });
      }
    }

    await this.client.bulkEditOperation.update({
      where: { id: operation.id },
      data: {
        succeededCount,
        failureDetails: failures.map(({ recordId, message }) => ({ recordId, message })),
      },
    });

    return {
      operationId: operation.id,
      requestedCount: recordIds.length,
      succeededCount,
      failures,
    };
  }

  private async applyToRecord(
    eventId: string,
    entityType: BulkEditEntityType,
    recordId: string,
    field: BulkEditField,
    value: string,
  ): Promise<void> {
    if (entityType === "CONTACT") {
      let data: Prisma.ContactUpdateManyMutationInput;
      if (field === "organization") data = { organization: value || null };
      else if (field === "jobTitle") data = { jobTitle: value || null };
      else data = { phone: value || null };
      const result = await this.client.contact.updateMany({
        where: { id: recordId, eventId, archivedAt: null },
        data,
      });
      if (result.count === 0) throw new RepositoryError("not-found", "The event-owned contact was not found.");
      return;
    }

    if (entityType === "GROUP") {
      const result = await this.client.contactGroup.updateMany({
        where: { id: recordId, eventId, archivedAt: null },
        data: { name: value },
      });
      if (result.count === 0) throw new RepositoryError("not-found", "The event-owned group was not found.");
      return;
    }

    const repository = new ProgramSessionRepository(this.client);
    if (field === "durationMinutes") {
      await repository.update(eventId, recordId, { durationMinutes: Number(value) });
      return;
    }
    if (field === "trackId") {
      await repository.update(eventId, recordId, { trackId: value === "" ? null : value });
      return;
    }
    await repository.update(eventId, recordId, { description: value || null });
  }
}
