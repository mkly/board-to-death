import { z } from "zod";

export const submissionBuiltInColumns = [
  { id: "formTitle", label: "Submission", group: "built-in" },
  { id: "applicant", label: "Applicant", group: "built-in" },
  { id: "email", label: "Applicant email", group: "built-in" },
  { id: "kind", label: "Type", group: "built-in" },
  { id: "categories", label: "Categories", group: "built-in" },
  { id: "assignees", label: "Assignees", group: "built-in" },
  { id: "status", label: "Status", group: "built-in" },
  { id: "submittedAt", label: "Submitted", group: "built-in" },
  { id: "updatedAt", label: "Last updated", group: "built-in" },
  { id: "averageScore", label: "Average score", group: "reporting" },
  { id: "reviewProgress", label: "Review progress", group: "reporting" },
] as const;

export type SubmissionBuiltInColumnId = (typeof submissionBuiltInColumns)[number]["id"];
export type SubmissionColumnId = SubmissionBuiltInColumnId | `answer:${string}`;

export interface SubmissionViewConfig {
  readonly columns: readonly SubmissionColumnId[];
  readonly filters: {
    readonly search?: string;
    readonly status?: string;
    readonly kind?: string;
    readonly categoryId?: string;
    readonly assigneeId?: string;
  };
  readonly sorting: { readonly id: string; readonly direction: "asc" | "desc" };
}

export const defaultSubmissionColumns: readonly SubmissionColumnId[] = [
  "formTitle",
  "applicant",
  "categories",
  "assignees",
  "status",
  "submittedAt",
];

const columnSchema = z
  .string()
  .refine(
    (value): value is SubmissionColumnId =>
      value.startsWith("answer:") || submissionBuiltInColumns.some((column) => column.id === value),
    "Unknown submission table column.",
  );

const viewSchema = z.object({
  columns: z.array(columnSchema).min(1).max(100),
  filters: z.object({
    search: z.string().max(200).optional(),
    status: z.string().max(40).optional(),
    kind: z.string().max(40).optional(),
    categoryId: z.string().max(100).optional(),
    assigneeId: z.string().max(100).optional(),
  }),
  sorting: z.object({ id: z.string().max(100), direction: z.enum(["asc", "desc"]) }),
});

export const defaultSubmissionView: SubmissionViewConfig = {
  columns: defaultSubmissionColumns,
  filters: {},
  sorting: { id: "submittedAt", direction: "desc" },
};

export function parseSubmissionView(value: unknown): SubmissionViewConfig {
  const parsed = viewSchema.safeParse(value);
  if (!parsed.success) return defaultSubmissionView;
  return {
    ...parsed.data,
    columns: Array.from(new Set(parsed.data.columns)),
  };
}

export function columnLabel(columnId: SubmissionColumnId, customLabels: Readonly<Record<string, string>>): string {
  if (columnId.startsWith("answer:")) return customLabels[columnId.slice(7)] ?? "Custom answer";
  return submissionBuiltInColumns.find(({ id }) => id === columnId)?.label ?? columnId;
}
