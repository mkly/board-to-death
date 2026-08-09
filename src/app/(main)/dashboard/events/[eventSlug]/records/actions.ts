"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { type BulkEditFailure, type BulkEditField, BulkEditOperationRepository } from "@/server/bulk-edit/operations";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

export interface BulkEditActionInput {
  readonly entityType: "CONTACT" | "SESSION" | "GROUP";
  readonly recordIds: readonly string[];
  readonly field: string;
  readonly value: string;
}

export interface BulkEditActionState {
  readonly status: "success" | "partial" | "error";
  readonly message: string;
  readonly failures?: readonly BulkEditFailure[];
}

const bulkEditSchema = z.object({
  eventSlug: z.string().trim().min(1),
  entityType: z.enum(["CONTACT", "SESSION", "GROUP"]),
  recordIds: z.array(z.uuid()).min(1, "Select at least one record.").max(100, "Select no more than 100 records."),
  field: z.string().trim().min(1),
  value: z.string().max(5_000, "Keep the field value under 5,000 characters."),
});

export async function applyBulkEdit(eventSlug: string, input: BulkEditActionInput): Promise<BulkEditActionState> {
  const parsed = bulkEditSchema.safeParse({ eventSlug, ...input });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Review the bulk edit." };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) {
    return { status: "error", message: "This event is not available." };
  }

  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: parsed.data.eventSlug },
    select: { id: true, slug: true },
  });
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    const result = await new BulkEditOperationRepository(client).apply({
      eventId: event.id,
      entityType: parsed.data.entityType,
      recordIds: parsed.data.recordIds,
      field: parsed.data.field as BulkEditField,
      value: parsed.data.value,
      performedBy: session.user.email,
    });
    revalidatePath(`/dashboard/events/${event.slug}/records`);
    if (parsed.data.entityType === "SESSION") revalidatePath(`/dashboard/events/${event.slug}/sessions`);
    if (parsed.data.entityType === "CONTACT") revalidatePath(`/dashboard/events/${event.slug}/contacts`);
    if (parsed.data.entityType === "GROUP") revalidatePath(`/dashboard/events/${event.slug}/groups`);
    if (result.failures.length > 0) {
      return {
        status: "partial",
        message: `${result.succeededCount} of ${result.requestedCount} records updated.`,
        failures: result.failures,
      };
    }
    return { status: "success", message: `${result.succeededCount} records updated.` };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
