import { ReportBaseType } from "../../generated/prisma/client.ts";

export type ReportFieldType = "text" | "number" | "boolean" | "date";
export type ReportFilterOperator = "contains" | "equals" | "notEquals" | "greaterThan" | "lessThan";

export interface ReportColumnDefinition {
  readonly id: string;
  readonly label: string;
  readonly type: ReportFieldType;
  readonly relatedType?: string;
}

export interface ReportFilter {
  readonly column: string;
  readonly operator: ReportFilterOperator;
  readonly value: string;
}

export interface ReportDefinition {
  readonly baseType: ReportBaseType;
  readonly columns: readonly string[];
  readonly filters: readonly ReportFilter[];
}

export const reportCatalog: Readonly<Record<ReportBaseType, readonly ReportColumnDefinition[]>> = {
  [ReportBaseType.SESSION]: [
    { id: "title", label: "Session title", type: "text" },
    { id: "kind", label: "Session kind", type: "text" },
    { id: "durationMinutes", label: "Duration (minutes)", type: "number" },
    { id: "track", label: "Track", type: "text", relatedType: "Track" },
    { id: "speakers", label: "Speaker names", type: "text", relatedType: "Speakers" },
    { id: "speakerEmails", label: "Speaker emails", type: "text", relatedType: "Speakers" },
    { id: "averageRating", label: "Evaluation rating", type: "number", relatedType: "Evaluations" },
    { id: "scheduledStart", label: "Scheduled start", type: "date", relatedType: "Agenda" },
    { id: "room", label: "Room", type: "text", relatedType: "Agenda" },
    { id: "archived", label: "Archived", type: "boolean" },
  ],
  [ReportBaseType.CONTACT]: [
    { id: "givenName", label: "Given name", type: "text" },
    { id: "familyName", label: "Family name", type: "text" },
    { id: "email", label: "Email", type: "text" },
    { id: "organization", label: "Organization", type: "text" },
    { id: "jobTitle", label: "Job title", type: "text" },
    { id: "phone", label: "Phone", type: "text" },
    { id: "groups", label: "Groups", type: "text", relatedType: "Groups" },
    { id: "archived", label: "Archived", type: "boolean" },
  ],
  [ReportBaseType.GROUP]: [
    { id: "name", label: "Group name", type: "text" },
    { id: "kind", label: "Group kind", type: "text" },
    { id: "slug", label: "Slug", type: "text" },
    { id: "memberCount", label: "Member count", type: "number", relatedType: "Contacts" },
    { id: "members", label: "Member names", type: "text", relatedType: "Contacts" },
    { id: "memberEmails", label: "Member emails", type: "text", relatedType: "Contacts" },
    { id: "archived", label: "Archived", type: "boolean" },
  ],
  [ReportBaseType.EVALUATION_PLAN]: [
    { id: "key", label: "Plan key", type: "text" },
    { id: "title", label: "Version title", type: "text" },
    { id: "status", label: "Status", type: "text" },
    { id: "versionNumber", label: "Version", type: "number" },
    { id: "roundCount", label: "Round count", type: "number", relatedType: "Rounds" },
    { id: "assignmentCount", label: "Assignments", type: "number", relatedType: "Evaluations" },
    { id: "completedEvaluations", label: "Completed evaluations", type: "number", relatedType: "Evaluations" },
    { id: "averageRating", label: "Average rating", type: "number", relatedType: "Evaluations" },
    { id: "activatedAt", label: "Activated at", type: "date" },
  ],
};

export const reportTemplates = [
  {
    id: "sessions-with-speakers",
    name: "Sessions with speaker details",
    description: "Session titles, tracks, durations, speaker names, and speaker email addresses.",
    definition: {
      baseType: ReportBaseType.SESSION,
      columns: ["title", "track", "durationMinutes", "speakers", "speakerEmails"],
      filters: [],
    },
  },
  {
    id: "sessions-with-evaluation-ratings",
    name: "Sessions with evaluation ratings",
    description: "Accepted program sessions and the average score from their source submission evaluations.",
    definition: {
      baseType: ReportBaseType.SESSION,
      columns: ["title", "track", "speakers", "averageRating"],
      filters: [],
    },
  },
] as const satisfies readonly {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly definition: ReportDefinition;
}[];

export function validateReportDefinition(definition: ReportDefinition): ReportDefinition {
  const catalog = reportCatalog[definition.baseType];
  const allowed = new Set(catalog.map(({ id }) => id));
  const columns = [...new Set(definition.columns)];
  if (columns.length === 0 || columns.some((column) => !allowed.has(column))) {
    throw new Error("Choose at least one supported report column.");
  }
  if (definition.filters.length > 10) throw new Error("A report can contain at most 10 filters.");
  for (const filter of definition.filters) {
    if (!allowed.has(filter.column) || filter.value.trim() === "") throw new Error("Report filters are invalid.");
  }
  return { baseType: definition.baseType, columns, filters: definition.filters };
}
