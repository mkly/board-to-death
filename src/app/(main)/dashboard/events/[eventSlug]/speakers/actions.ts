"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { createConfiguredSpeakerMagicLinkDelivery } from "@/server/speaker-auth/configured-speaker-magic-link";
import { parseSpeakerCsv, previewSpeakerCsvRows, type SpeakerCsvPreviewRow } from "@/server/speakers/csv";
import { SpeakerRepository } from "@/server/speakers/repositories";

export interface ResendSpeakerLinkActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
}

const requestSchema = z.object({
  eventSlug: z.string().trim().min(1),
  speakerId: z.uuid(),
});

export interface SpeakerCsvImportState {
  readonly status: "idle" | "preview" | "success" | "error";
  readonly message?: string;
  readonly rows?: readonly SpeakerCsvPreviewRow[];
  readonly counts?: {
    readonly created: number;
    readonly skipped: number;
    readonly rejected: number;
  };
}

const speakerCsvPayloadSchema = z
  .array(
    z.object({
      rowNumber: z.number().int().min(2),
      email: z.email(),
      givenName: z.string().trim().min(1).max(200),
      familyName: z.string().trim().min(1).max(200),
      jobTitle: z.string().max(500).nullable(),
      organization: z.string().max(500).nullable(),
      biography: z.string().max(20_000).nullable(),
    }),
  )
  .min(1)
  .max(500)
  .refine((rows) => new Set(rows.map(({ email }) => email.toLowerCase())).size === rows.length);

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;
  return getDatabaseClient().event.findFirst({
    where: { slug: eventSlug, archivedAt: null },
    select: { id: true, slug: true },
  });
}

function csvCounts(rows: readonly SpeakerCsvPreviewRow[]) {
  return {
    created: rows.filter(({ outcome }) => outcome === "created").length,
    skipped: rows.filter(({ outcome }) => outcome === "skipped").length,
    rejected: rows.filter(({ outcome }) => outcome === "rejected").length,
  };
}

export async function previewSpeakerCsv(
  _previousState: SpeakerCsvImportState,
  formData: FormData,
): Promise<SpeakerCsvImportState> {
  const event = await authorizedEvent(stringValue(formData, "eventSlug"));
  if (!event) return { status: "error", message: "This event is not available." };
  const upload = formData.get("csvFile");
  if (!(upload instanceof File) || upload.size === 0) return { status: "error", message: "Choose a CSV file." };
  if (upload.size > 1_000_000) return { status: "error", message: "Keep the CSV file under 1 MB." };

  try {
    const parsedRows = await parseSpeakerCsv(await upload.text());
    if (parsedRows.length > 500) return { status: "error", message: "Import at most 500 rows at a time." };
    const existing = await new SpeakerRepository(getDatabaseClient()).list(event.id);
    const rows = previewSpeakerCsvRows(parsedRows, new Set(existing.map(({ profile }) => profile.email.toLowerCase())));
    return {
      status: "preview",
      message: "Preview ready. Existing and rejected rows will not be applied.",
      rows,
      counts: csvCounts(rows),
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The CSV file could not be read." };
  }
}

export async function applySpeakerCsv(
  _previousState: SpeakerCsvImportState,
  formData: FormData,
): Promise<SpeakerCsvImportState> {
  const event = await authorizedEvent(stringValue(formData, "eventSlug"));
  if (!event) return { status: "error", message: "This event is not available." };
  let decoded: unknown;
  try {
    decoded = JSON.parse(stringValue(formData, "previewPayload"));
  } catch {
    return { status: "error", message: "Preview data is invalid. Upload the CSV again." };
  }
  const parsed = speakerCsvPayloadSchema.safeParse(decoded);
  if (!parsed.success) return { status: "error", message: "Preview data is invalid. Upload the CSV again." };

  const repository = new SpeakerRepository(getDatabaseClient());
  const rows: SpeakerCsvPreviewRow[] = [];
  for (const payload of parsed.data) {
    const identity = {
      rowNumber: payload.rowNumber,
      name: `${payload.givenName} ${payload.familyName}`,
      email: payload.email,
    };
    try {
      await repository.create({ eventId: event.id, ...payload });
      rows.push({ ...identity, outcome: "created", errors: [] });
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "conflict") {
        rows.push({ ...identity, outcome: "skipped", errors: ["A speaker with this email is already in the roster."] });
      } else {
        rows.push({
          ...identity,
          outcome: "rejected",
          errors: [error instanceof RepositoryError ? error.message : "The speaker could not be imported."],
        });
      }
    }
  }
  const counts = csvCounts(rows);
  revalidatePath(`/dashboard/events/${event.slug}/speakers`);
  return {
    status: "success",
    message: `Import finished: ${counts.created} created, ${counts.skipped} skipped, and ${counts.rejected} rejected.`,
    rows,
    counts,
  };
}

export async function resendSpeakerPortalLink(
  eventSlug: string,
  speakerId: string,
  _previousState: ResendSpeakerLinkActionState,
): Promise<ResendSpeakerLinkActionState> {
  const parsed = requestSchema.safeParse({ eventSlug, speakerId });
  if (!parsed.success) return { status: "error", message: "The speaker link request is invalid." };

  const session = await auth.api.getSession({ headers: await headers() });
  if (!(await isAuthorizedAdminSession(session, { slug: parsed.data.eventSlug }))) {
    return { status: "error", message: "Administrator access is required." };
  }

  const event = await getDatabaseClient().event.findFirst({
    where: { slug: parsed.data.eventSlug, archivedAt: null },
    select: { id: true },
  });
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    await createConfiguredSpeakerMagicLinkDelivery().resendForSpeaker({
      eventId: event.id,
      speakerId: parsed.data.speakerId,
    });
    return { status: "success", message: "A fresh speaker portal sign-in link was sent." };
  } catch (error) {
    console.error("[speaker-auth] Could not resend a speaker portal link.", error);
    return { status: "error", message: "The sign-in link could not be sent. Try again." };
  }
}
