"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { CfpSubmissionStatus } from "@/generated/prisma/client";
import type { CfpFormDefinition } from "@/lib/cfp";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { type AdminIntakeOutcome, AdminIntakeRepository } from "@/server/intake/admin-intake";
import { type AdminIntakeCsvRow, parseAdminIntakeCsv } from "@/server/intake/csv";
import { SpeakerRepository } from "@/server/speakers/repositories";

export interface ManualIntakeState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly recordId?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

interface PreparedAbstractRow {
  readonly kind: "abstract";
  readonly rowNumber: number;
  readonly clientIdentifier: string;
  readonly formVersionId: string;
  readonly status: CfpSubmissionStatus;
  readonly values: Readonly<Record<string, unknown>>;
  readonly categoryIds: readonly string[];
  readonly speakerIds: readonly string[];
}

interface PreparedSessionRow {
  readonly kind: "guaranteed_session";
  readonly rowNumber: number;
  readonly clientIdentifier: string;
  readonly title: string;
  readonly description: string;
  readonly durationMinutes: number;
  readonly trackId: string | null;
  readonly speakerIds: readonly string[];
}

type PreparedRow = PreparedAbstractRow | PreparedSessionRow;

export interface CsvPreviewRow {
  readonly rowNumber: number;
  readonly clientIdentifier: string;
  readonly kind: string;
  readonly title: string;
  readonly outcome: AdminIntakeOutcome | "rejected";
  readonly errors: readonly string[];
  readonly payload?: PreparedRow;
}

export interface CsvIntakeState {
  readonly status: "idle" | "preview" | "success" | "error";
  readonly message?: string;
  readonly rows?: readonly CsvPreviewRow[];
  readonly counts?: Readonly<Record<AdminIntakeOutcome | "rejected", number>>;
}

const preparedRowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("abstract"),
    rowNumber: z.number().int().min(2),
    clientIdentifier: z.string().min(1).max(100),
    formVersionId: z.uuid(),
    status: z.enum(CfpSubmissionStatus),
    values: z.record(z.string(), z.unknown()),
    categoryIds: z.array(z.uuid()).max(100),
    speakerIds: z.array(z.uuid()).max(100),
  }),
  z.object({
    kind: z.literal("guaranteed_session"),
    rowNumber: z.number().int().min(2),
    clientIdentifier: z.string().min(1).max(100),
    title: z.string().min(1).max(200),
    description: z.string().max(5_000),
    durationMinutes: z.number().int().min(1).max(1_440),
    trackId: z.uuid().nullable(),
    speakerIds: z.array(z.uuid()).max(100),
  }),
]);

const previewPayloadSchema = z.array(preparedRowSchema).min(1).max(500);

function value(formData: FormData, name: string): string {
  const entry = formData.get(name);
  return typeof entry === "string" ? entry : "";
}

function errors(error: z.ZodError): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;
  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true },
  });
  return event ? { ...event, actorId: session.user.email.toLowerCase() } : null;
}

function answerValues(definition: CfpFormDefinition, formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const question of definition.sections.flatMap((section) => section.questions)) {
    const name = `answer.${question.id}`;
    if (question.type === "checkbox") values[question.id] = formData.get(name) !== null;
    else if (question.type === "multi_select") values[question.id] = formData.getAll(name);
    else values[question.id] = formData.get(name) ?? undefined;
  }
  return values;
}

function repositoryMessage(error: RepositoryError): string {
  if (error.code === "conflict") return error.message;
  if (error.code === "not-found")
    return "A selected form, participant, category, or track is not available for this event.";
  return error.message;
}

function revalidateIntake(eventSlug: string): void {
  revalidatePath(`/dashboard/events/${eventSlug}/sessions`);
  revalidatePath(`/dashboard/events/${eventSlug}/sessions/intake`);
  revalidatePath(`/dashboard/events/${eventSlug}/submissions`);
}

export async function createAdminIntake(
  _previousState: ManualIntakeState,
  formData: FormData,
): Promise<ManualIntakeState> {
  const base = z
    .object({
      eventSlug: z.string().trim().min(1),
      kind: z.enum(["abstract", "guaranteed_session"]),
      clientIdentifier: z
        .string()
        .trim()
        .min(1, "Enter a client identifier.")
        .max(100)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Use letters, numbers, dots, underscores, colons, or hyphens."),
    })
    .safeParse({
      eventSlug: value(formData, "eventSlug"),
      kind: value(formData, "kind"),
      clientIdentifier: value(formData, "clientIdentifier"),
    });
  if (!base.success) return { status: "error", message: "Review the highlighted fields.", errors: errors(base.error) };
  const event = await authorizedEvent(base.data.eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const repository = new AdminIntakeRepository(getDatabaseClient());

  try {
    if (base.data.kind === "guaranteed_session") {
      const parsed = z
        .object({
          title: z.string().trim().min(1, "Enter a session title.").max(200),
          description: z.string().trim().max(5_000),
          durationMinutes: z.coerce.number().int().min(1).max(1_440),
          trackId: z.union([z.literal(""), z.literal("unassigned"), z.uuid()]),
          speakerIds: z.array(z.uuid()).max(100),
        })
        .safeParse({
          title: value(formData, "title"),
          description: value(formData, "description"),
          durationMinutes: value(formData, "durationMinutes"),
          trackId: value(formData, "trackId"),
          speakerIds: formData.getAll("speakerIds"),
        });
      if (!parsed.success) {
        return { status: "error", message: "Review the highlighted session fields.", errors: errors(parsed.error) };
      }
      const result = await repository.upsertGuaranteedSession({
        eventId: event.id,
        clientIdentifier: base.data.clientIdentifier,
        title: parsed.data.title,
        description: parsed.data.description,
        durationMinutes: parsed.data.durationMinutes,
        trackId: parsed.data.trackId === "" || parsed.data.trackId === "unassigned" ? null : parsed.data.trackId,
        speakerIds: parsed.data.speakerIds,
        actorId: event.actorId,
        source: "manual",
        createOnly: true,
      });
      revalidateIntake(event.slug);
      return { status: "success", message: "Guaranteed session created.", recordId: result.id };
    }

    const parsed = z
      .object({
        formVersionId: z.uuid("Choose a CFP form."),
        submissionStatus: z.enum(CfpSubmissionStatus),
        speakerIds: z.array(z.uuid()).max(100),
        categoryIds: z.array(z.uuid()).max(100),
      })
      .safeParse({
        formVersionId: value(formData, "formVersionId"),
        submissionStatus: value(formData, "submissionStatus"),
        speakerIds: formData.getAll("speakerIds"),
        categoryIds: formData.getAll("categoryIds"),
      });
    if (!parsed.success) {
      return { status: "error", message: "Review the highlighted abstract fields.", errors: errors(parsed.error) };
    }
    const form = (await repository.listForms(event.id)).find(({ id }) => id === parsed.data.formVersionId);
    if (!form) return { status: "error", message: "The selected CFP form is not available for this event." };
    const result = await repository.upsertAbstract({
      eventId: event.id,
      clientIdentifier: base.data.clientIdentifier,
      formVersionId: form.id,
      status: parsed.data.submissionStatus,
      values: answerValues(form.definition, formData),
      categoryIds: parsed.data.categoryIds,
      speakerIds: parsed.data.speakerIds,
      actorId: event.actorId,
      source: "manual",
      createOnly: true,
    });
    revalidateIntake(event.slug);
    return { status: "success", message: "Abstract created.", recordId: result.id };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}

function previewCounts(rows: readonly CsvPreviewRow[]) {
  const counts: Record<AdminIntakeOutcome | "rejected", number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
  };
  for (const row of rows) counts[row.outcome] += 1;
  return counts;
}

function rowTitle(row: AdminIntakeCsvRow): string {
  if (row.title) return row.title;
  if (row.answers && typeof row.answers === "object" && "title" in row.answers) return String(row.answers.title);
  return "Untitled";
}

export async function previewAdminIntakeCsv(
  _previousState: CsvIntakeState,
  formData: FormData,
): Promise<CsvIntakeState> {
  const eventSlug = value(formData, "eventSlug");
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const upload = formData.get("csvFile");
  if (!(upload instanceof File) || upload.size === 0) return { status: "error", message: "Choose a CSV file." };
  if (upload.size > 1_000_000) return { status: "error", message: "Keep the CSV file under 1 MB." };

  try {
    const rawRows = await parseAdminIntakeCsv(await upload.text());
    if (rawRows.length > 500) return { status: "error", message: "Import at most 500 rows at a time." };
    const client = getDatabaseClient();
    const repository = new AdminIntakeRepository(client);
    const [forms, speakers, tracks, categories] = await Promise.all([
      repository.listForms(event.id),
      new SpeakerRepository(client).list(event.id),
      client.track.findMany({ where: { eventId: event.id }, select: { id: true, name: true } }),
      client.cfpCategory.findMany({ where: { eventId: event.id }, select: { id: true, key: true } }),
    ]);
    const formByKey = new Map(forms.map((form) => [form.key.toLowerCase(), form]));
    const speakerByEmail = new Map(speakers.map((speaker) => [speaker.profile.email.toLowerCase(), speaker.id]));
    const trackByName = new Map(tracks.map((track) => [track.name.toLowerCase(), track.id]));
    const categoryByKey = new Map(categories.map((category) => [category.key.toLowerCase(), category.id]));
    const rows: CsvPreviewRow[] = [];

    for (const row of rawRows) {
      const rowErrors = [...row.parseErrors];
      const speakerIds = row.participantEmails.flatMap((email) => {
        const id = speakerByEmail.get(email);
        if (!id) rowErrors.push(`Participant ${email} was not found in this event.`);
        return id ? [id] : [];
      });
      let payload: PreparedRow | undefined;
      if (row.kind === "abstract") {
        const form = formByKey.get(row.formKey);
        if (!form) rowErrors.push(`CFP form ${row.formKey || "(blank)"} was not found in this event.`);
        const parsedStatus = z.enum(CfpSubmissionStatus).safeParse(row.status || "SUBMITTED");
        if (!parsedStatus.success) rowErrors.push(`Status ${row.status || "(blank)"} is invalid.`);
        const categoryIds = row.categoryKeys.flatMap((key) => {
          const id = categoryByKey.get(key);
          if (!id) rowErrors.push(`Category ${key} was not found in this event.`);
          return id ? [id] : [];
        });
        if (
          form &&
          parsedStatus.success &&
          row.answers &&
          typeof row.answers === "object" &&
          !Array.isArray(row.answers)
        ) {
          payload = {
            kind: "abstract",
            rowNumber: row.rowNumber,
            clientIdentifier: row.clientIdentifier,
            formVersionId: form.id,
            status: parsedStatus.data,
            values: row.answers as Readonly<Record<string, unknown>>,
            categoryIds,
            speakerIds,
          };
        }
      } else if (row.kind === "guaranteed_session") {
        const duration = Number(row.durationMinutes);
        if (!Number.isInteger(duration) || duration < 1 || duration > 1_440) {
          rowErrors.push("duration_minutes must be a whole number between 1 and 1,440.");
        }
        const trackId = row.track === "" ? null : trackByName.get(row.track.toLowerCase());
        if (row.track !== "" && !trackId) rowErrors.push(`Track ${row.track} was not found in this event.`);
        payload = {
          kind: "guaranteed_session",
          rowNumber: row.rowNumber,
          clientIdentifier: row.clientIdentifier,
          title: row.title,
          description: row.description,
          durationMinutes: duration,
          trackId: trackId ?? null,
          speakerIds,
        };
      } else {
        rowErrors.push("kind must be abstract or guaranteed_session.");
      }

      if (!payload || rowErrors.length > 0) {
        rows.push({
          rowNumber: row.rowNumber,
          clientIdentifier: row.clientIdentifier,
          kind: row.kind,
          title: rowTitle(row),
          outcome: "rejected",
          errors: rowErrors,
        });
        continue;
      }
      try {
        const result =
          payload.kind === "abstract"
            ? await repository.upsertAbstract({
                eventId: event.id,
                ...payload,
                actorId: event.actorId,
                source: "csv",
                previewOnly: true,
              })
            : await repository.upsertGuaranteedSession({
                eventId: event.id,
                ...payload,
                actorId: event.actorId,
                source: "csv",
                previewOnly: true,
              });
        rows.push({
          rowNumber: row.rowNumber,
          clientIdentifier: row.clientIdentifier,
          kind: row.kind,
          title: rowTitle(row),
          outcome: result.outcome,
          errors: [],
          payload,
        });
      } catch (error) {
        rows.push({
          rowNumber: row.rowNumber,
          clientIdentifier: row.clientIdentifier,
          kind: row.kind,
          title: rowTitle(row),
          outcome: "rejected",
          errors: [error instanceof RepositoryError ? repositoryMessage(error) : "The row could not be validated."],
        });
      }
    }
    return {
      status: "preview",
      message: "Preview ready. Rejected rows will not be applied.",
      rows,
      counts: previewCounts(rows),
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The CSV file could not be read." };
  }
}

export async function applyAdminIntakeCsv(_previousState: CsvIntakeState, formData: FormData): Promise<CsvIntakeState> {
  const eventSlug = value(formData, "eventSlug");
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  let decoded: unknown;
  try {
    decoded = JSON.parse(value(formData, "previewPayload"));
  } catch {
    return { status: "error", message: "Preview data is invalid. Upload the CSV again." };
  }
  const parsed = previewPayloadSchema.safeParse(decoded);
  if (!parsed.success) return { status: "error", message: "Preview data is invalid. Upload the CSV again." };

  const repository = new AdminIntakeRepository(getDatabaseClient());
  const rows: CsvPreviewRow[] = [];
  for (const payload of parsed.data) {
    const identity = {
      rowNumber: payload.rowNumber,
      clientIdentifier: payload.clientIdentifier,
      kind: payload.kind,
      title: payload.kind === "guaranteed_session" ? payload.title : "Abstract",
    };
    try {
      const result =
        payload.kind === "abstract"
          ? await repository.upsertAbstract({
              eventId: event.id,
              ...payload,
              actorId: event.actorId,
              source: "csv",
            })
          : await repository.upsertGuaranteedSession({
              eventId: event.id,
              ...payload,
              actorId: event.actorId,
              source: "csv",
            });
      rows.push({ ...identity, outcome: result.outcome, errors: [] });
    } catch (error) {
      rows.push({
        ...identity,
        outcome: "rejected",
        errors: [error instanceof RepositoryError ? repositoryMessage(error) : "The row could not be applied."],
      });
    }
  }
  revalidateIntake(event.slug);
  const counts = previewCounts(rows);
  return {
    status: "success",
    message: `Import applied: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.rejected} rejected.`,
    rows,
    counts,
  };
}
