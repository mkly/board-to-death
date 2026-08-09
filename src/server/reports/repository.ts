import type { Prisma, PrismaClient, ReportBaseType } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { type ReportDefinition, type ReportFilter, reportTemplates, validateReportDefinition } from "./catalog.ts";

export interface SavedReportRecord extends ReportDefinition {
  readonly id: string;
  readonly eventId: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function normalizedName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 100) {
    throw new RepositoryError("invalid-input", "Report names must be between 1 and 100 characters.");
  }
  return name;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return [];
  return value;
}

function parseFilters(value: unknown): ReportFilter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { column, operator, value: filterValue } = item as Record<string, unknown>;
    if (
      typeof column !== "string" ||
      typeof filterValue !== "string" ||
      !["contains", "equals", "notEquals", "greaterThan", "lessThan"].includes(String(operator))
    ) {
      return [];
    }
    return [{ column, operator: operator as ReportFilter["operator"], value: filterValue }];
  });
}

function fromStored(stored: {
  id: string;
  eventId: string;
  name: string;
  baseType: ReportBaseType;
  columns: unknown;
  filters: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SavedReportRecord {
  const definition = validateReportDefinition({
    baseType: stored.baseType,
    columns: parseStringArray(stored.columns),
    filters: parseFilters(stored.filters),
  });
  return { ...stored, ...definition };
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    if (String(error.code) === "P2002") {
      throw new RepositoryError("conflict", "A report with this name already exists for the event.");
    }
  }
  throw error;
}

export class ReportRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async list(eventId: string): Promise<readonly SavedReportRecord[]> {
    return (
      await this.client.savedReport.findMany({ where: { eventId }, orderBy: [{ name: "asc" }, { id: "asc" }] })
    ).map(fromStored);
  }

  async get(eventId: string, reportId: string): Promise<SavedReportRecord | null> {
    const report = await this.client.savedReport.findUnique({ where: { eventId_id: { eventId, id: reportId } } });
    return report ? fromStored(report) : null;
  }

  async require(eventId: string, reportId: string): Promise<SavedReportRecord> {
    const report = await this.get(eventId, reportId);
    if (!report) throw new RepositoryError("not-found", "This report is not available for the event.");
    return report;
  }

  async create(eventId: string, name: string, definition: ReportDefinition): Promise<SavedReportRecord> {
    const validated = validateReportDefinition(definition);
    try {
      return fromStored(
        await this.client.savedReport.create({
          data: {
            eventId,
            name: normalizedName(name),
            baseType: validated.baseType,
            columns: validated.columns as Prisma.InputJsonValue,
            filters: validated.filters.map(({ column, operator, value }) => ({ column, operator, value })),
          },
        }),
      );
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async update(
    eventId: string,
    reportId: string,
    name: string,
    definition: ReportDefinition,
  ): Promise<SavedReportRecord> {
    await this.require(eventId, reportId);
    const validated = validateReportDefinition(definition);
    try {
      return fromStored(
        await this.client.savedReport.update({
          where: { eventId_id: { eventId, id: reportId } },
          data: {
            name: normalizedName(name),
            baseType: validated.baseType,
            columns: validated.columns as Prisma.InputJsonValue,
            filters: validated.filters.map(({ column, operator, value }) => ({ column, operator, value })),
          },
        }),
      );
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async duplicate(eventId: string, reportId: string): Promise<SavedReportRecord> {
    const source = await this.require(eventId, reportId);
    const names = new Set((await this.list(eventId)).map(({ name }) => name));
    let name = `${source.name} copy`;
    for (let suffix = 2; names.has(name); suffix += 1) name = `${source.name} copy ${suffix}`;
    return this.create(eventId, name, source);
  }

  async createFromTemplate(eventId: string, templateId: string): Promise<SavedReportRecord> {
    const template = reportTemplates.find(({ id }) => id === templateId);
    if (!template) throw new RepositoryError("invalid-input", "The selected report template is not supported.");
    const names = new Set((await this.list(eventId)).map(({ name }) => name));
    let name: string = template.name;
    for (let suffix = 2; names.has(name); suffix += 1) name = `${template.name} ${suffix}`;
    return this.create(eventId, name, template.definition);
  }

  async delete(eventId: string, reportId: string): Promise<void> {
    const result = await this.client.savedReport.deleteMany({ where: { eventId, id: reportId } });
    if (result.count === 0) throw new RepositoryError("not-found", "This report is not available for the event.");
  }
}
