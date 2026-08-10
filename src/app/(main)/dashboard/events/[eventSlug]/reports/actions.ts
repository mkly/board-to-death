"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { ReportBaseType } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import type { ReportFilter } from "@/server/reports/catalog";
import { ReportRepository } from "@/server/reports/repository";

export interface ReportMutationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly reportId?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const baseFields = {
  eventSlug: z.string().trim().min(1),
};

const definitionFields = {
  ...baseFields,
  name: z.string().trim().min(1, "Enter a report name.").max(100, "Keep the name under 100 characters."),
  baseType: z.enum(ReportBaseType),
  columns: z.string().min(1),
  filters: z.string(),
};

const mutationSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("create"), ...definitionFields }),
  z.object({ intent: z.literal("update"), reportId: z.uuid(), ...definitionFields }),
  z.object({ intent: z.literal("template"), templateId: z.string().trim().min(1), ...baseFields }),
  z.object({ intent: z.literal("duplicate"), reportId: z.uuid(), ...baseFields }),
  z.object({ intent: z.literal("delete"), reportId: z.uuid(), ...baseFields }),
]);

function formObject(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  );
}

function errors(error: z.ZodError): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    result[field] = [...(result[field] ?? []), issue.message];
  }
  return result;
}

function definition(data: { baseType: ReportBaseType; columns: string; filters: string }) {
  let columns: unknown;
  let filters: unknown;
  try {
    columns = JSON.parse(data.columns);
    filters = JSON.parse(data.filters);
  } catch {
    throw new RepositoryError("invalid-input", "The report definition could not be read.");
  }
  if (!Array.isArray(columns) || columns.some((column) => typeof column !== "string")) {
    throw new RepositoryError("invalid-input", "Choose at least one report column.");
  }
  if (!Array.isArray(filters)) throw new RepositoryError("invalid-input", "The report filters could not be read.");
  return { baseType: data.baseType, columns, filters: filters as ReportFilter[] };
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;
  return getDatabaseClient().event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
}

export async function mutateReport(
  _previousState: ReportMutationState,
  formData: FormData,
): Promise<ReportMutationState> {
  const parsed = mutationSchema.safeParse(formObject(formData));
  if (!parsed.success) {
    return { status: "error", message: "Review the highlighted report fields.", errors: errors(parsed.error) };
  }
  const event = await authorizedEvent(parsed.data.eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const repository = new ReportRepository(getDatabaseClient());
  try {
    let reportId: string | undefined;
    switch (parsed.data.intent) {
      case "create":
        reportId = (await repository.create(event.id, parsed.data.name, definition(parsed.data))).id;
        break;
      case "update":
        reportId = (await repository.update(event.id, parsed.data.reportId, parsed.data.name, definition(parsed.data)))
          .id;
        break;
      case "template":
        reportId = (await repository.createFromTemplate(event.id, parsed.data.templateId)).id;
        break;
      case "duplicate":
        reportId = (await repository.duplicate(event.id, parsed.data.reportId)).id;
        break;
      case "delete":
        await repository.delete(event.id, parsed.data.reportId);
        break;
    }
    revalidatePath(`/dashboard/events/${event.slug}/reports`);
    return { status: "success", message: "Report changes saved.", reportId };
  } catch (error) {
    if (error instanceof RepositoryError || error instanceof Error) {
      return { status: "error", message: error.message };
    }
    throw error;
  }
}
