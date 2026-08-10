"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { SpreadsheetImportEntityType } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import {
  commitSpreadsheetImport,
  type ImportFieldOption,
  type ImportPreview,
  listImportFields,
  MAX_IMPORT_BYTES,
  parseSpreadsheet,
  previewSpreadsheetImport,
} from "@/server/imports/spreadsheets";

export interface SpreadsheetActionState {
  readonly status: "idle" | "ready" | "preview" | "success" | "error";
  readonly message?: string;
  readonly headers?: readonly string[];
  readonly fields?: readonly ImportFieldOption[];
  readonly preview?: ImportPreview;
  readonly importId?: string;
}

const requestSchema = z.object({
  eventSlug: z.string().trim().min(1),
  entityType: z.enum(SpreadsheetImportEntityType),
});

function stringValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;
  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true },
  });
  return event ? { ...event, actorId: session.user.email.toLocaleLowerCase() } : null;
}

async function requestContext(formData: FormData) {
  const parsed = requestSchema.safeParse({
    eventSlug: stringValue(formData, "eventSlug"),
    entityType: stringValue(formData, "entityType"),
  });
  if (!parsed.success) return null;
  const event = await authorizedEvent(parsed.data.eventSlug);
  return event ? { event, entityType: parsed.data.entityType } : null;
}

async function uploadedSpreadsheet(formData: FormData) {
  const upload = formData.get("spreadsheet");
  if (!(upload instanceof File) || upload.size === 0) {
    throw new RepositoryError("invalid-input", "Choose a CSV or XLSX file.");
  }
  if (upload.size > MAX_IMPORT_BYTES) {
    throw new RepositoryError("invalid-input", "Keep the spreadsheet under 1 MB.");
  }
  return {
    fileName: upload.name,
    spreadsheet: await parseSpreadsheet(upload.name, new Uint8Array(await upload.arrayBuffer())),
  };
}

function mapping(formData: FormData): Readonly<Record<string, string>> {
  try {
    const parsed = z.record(z.string(), z.string()).safeParse(JSON.parse(stringValue(formData, "mapping")));
    if (parsed.success) return parsed.data;
  } catch {
    // The shared error below is clearer than exposing JSON parser details.
  }
  throw new RepositoryError("invalid-input", "The column mapping is invalid. Inspect the file again.");
}

function errorState(error: unknown): SpreadsheetActionState {
  if (error instanceof RepositoryError) return { status: "error", message: error.message };
  return { status: "error", message: "The spreadsheet could not be processed." };
}

export async function inspectSpreadsheetAction(formData: FormData): Promise<SpreadsheetActionState> {
  const context = await requestContext(formData);
  if (!context) return { status: "error", message: "This event is not available." };
  try {
    const upload = await uploadedSpreadsheet(formData);
    const fields = await listImportFields(getDatabaseClient(), context.event.id, context.entityType);
    return {
      status: "ready",
      message: `${upload.spreadsheet.rows.length} rows found. Map the columns, then preview the import.`,
      headers: upload.spreadsheet.headers,
      fields,
    };
  } catch (error) {
    return errorState(error);
  }
}

export async function previewSpreadsheetAction(formData: FormData): Promise<SpreadsheetActionState> {
  const context = await requestContext(formData);
  if (!context) return { status: "error", message: "This event is not available." };
  try {
    const upload = await uploadedSpreadsheet(formData);
    const preview = await previewSpreadsheetImport(
      getDatabaseClient(),
      context.event.id,
      context.entityType,
      mapping(formData),
      upload.spreadsheet,
    );
    return {
      status: "preview",
      message:
        preview.rejected > 0
          ? "Fix every rejected row before committing. Nothing has been changed."
          : "Preview is valid. Commit will apply every row in one transaction.",
      preview,
    };
  } catch (error) {
    return errorState(error);
  }
}

export async function commitSpreadsheetAction(formData: FormData): Promise<SpreadsheetActionState> {
  const context = await requestContext(formData);
  if (!context) return { status: "error", message: "This event is not available." };
  try {
    const upload = await uploadedSpreadsheet(formData);
    const result = await commitSpreadsheetImport(getDatabaseClient(), {
      eventId: context.event.id,
      actorId: context.event.actorId,
      entityType: context.entityType,
      fileName: upload.fileName,
      mapping: mapping(formData),
      spreadsheet: upload.spreadsheet,
    });
    revalidatePath(`/dashboard/events/${context.event.slug}/imports`);
    revalidatePath(`/dashboard/events/${context.event.slug}/contacts`);
    revalidatePath(`/dashboard/events/${context.event.slug}/sessions`);
    return {
      status: "success",
      message: `Import committed: ${result.preview.created} created and ${result.preview.updated} updated.`,
      importId: result.importId,
      preview: result.preview,
    };
  } catch (error) {
    return errorState(error);
  }
}
