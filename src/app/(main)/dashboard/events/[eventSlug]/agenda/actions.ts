"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { AgendaConflictError, type AgendaConflictPolicy, AgendaPlacementRepository } from "@/server/agenda";
import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { emitWebhookEvent } from "@/server/developer-api/webhooks";
import { RepositoryError } from "@/server/events/repositories";
import { ProgramSessionRepository } from "@/server/sessions/repositories";

export interface AgendaConflictState {
  readonly type: "event-boundary" | "room" | "speaker" | "track";
  readonly placementIds: readonly string[];
  readonly resourceId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly explanation: string;
}

export interface AgendaMutationState {
  readonly status: "idle" | "success" | "error" | "conflict";
  readonly message?: string;
  readonly sessionId?: string;
  readonly conflicts?: readonly AgendaConflictState[];
  readonly confirmationRequired?: boolean;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
  readonly values?: {
    readonly startsAt: string;
    readonly durationMinutes: string;
    readonly roomId: string;
    readonly trackId: string;
    readonly conflictPolicy: AgendaConflictPolicy;
  };
}

const placementSchema = z
  .object({
    eventSlug: z.string().trim().min(1),
    sessionId: z.string().uuid("The selected session is invalid."),
    placementId: z.string().trim(),
    expectedVersion: z.coerce.number().int().min(0),
    startsAt: z.string().trim().min(1, "Choose a start time."),
    durationMinutes: z.coerce
      .number({ error: "Enter a duration in minutes." })
      .int("Duration must be a whole number of minutes.")
      .min(1, "Duration must be at least one minute.")
      .max(1_440, "Duration cannot exceed 1,440 minutes."),
    roomId: z.string().uuid("Choose an event room."),
    trackId: z.string().trim(),
    conflictPolicy: z.enum(["prevent", "explicit-confirm"]),
    conflictsConfirmed: z.boolean(),
  })
  .superRefine(({ expectedVersion, placementId, trackId }, context) => {
    if (placementId !== "" && !z.uuid().safeParse(placementId).success) {
      context.addIssue({ code: "custom", path: ["placementId"], message: "The agenda placement is invalid." });
    }
    if ((placementId === "") !== (expectedVersion === 0)) {
      context.addIssue({ code: "custom", path: ["expectedVersion"], message: "Reload this agenda and try again." });
    }
    if (trackId !== "" && trackId !== "unassigned" && !z.uuid().safeParse(trackId).success) {
      context.addIssue({ code: "custom", path: ["trackId"], message: "The selected track is invalid." });
    }
  });

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function validationErrors(error: z.ZodError): Readonly<Record<string, readonly string[]>> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) return null;
  return getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true, timezone: true },
  });
}

function localDateTimeToInstant(value: string, timezone: string): Date | null {
  try {
    const zoned = Temporal.PlainDateTime.from(value).toZonedDateTime(timezone, { disambiguation: "reject" });
    return new Date(zoned.epochMilliseconds);
  } catch {
    return null;
  }
}

function repositoryMessage(error: RepositoryError): string {
  if (error.code === "not-found") return "This session, room, track, or placement is not available for this event.";
  return error.message;
}

export async function saveAgendaPlacement(
  _previousState: AgendaMutationState,
  formData: FormData,
): Promise<AgendaMutationState> {
  const parsed = placementSchema.safeParse({
    eventSlug: stringValue(formData, "eventSlug"),
    sessionId: stringValue(formData, "sessionId"),
    placementId: stringValue(formData, "placementId"),
    expectedVersion: stringValue(formData, "expectedVersion"),
    startsAt: stringValue(formData, "startsAt"),
    durationMinutes: stringValue(formData, "durationMinutes"),
    roomId: stringValue(formData, "roomId"),
    trackId: stringValue(formData, "trackId"),
    conflictPolicy: stringValue(formData, "conflictPolicy"),
    conflictsConfirmed: stringValue(formData, "conflictsConfirmed") === "true",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted agenda fields.",
      errors: validationErrors(parsed.error),
    };
  }

  const event = await authorizedEvent(parsed.data.eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const values = {
    startsAt: parsed.data.startsAt,
    durationMinutes: String(parsed.data.durationMinutes),
    roomId: parsed.data.roomId,
    trackId: parsed.data.trackId,
    conflictPolicy: parsed.data.conflictPolicy as AgendaConflictPolicy,
  };
  const startsAt = localDateTimeToInstant(parsed.data.startsAt, event.timezone);
  if (!startsAt) {
    return {
      status: "error",
      message: "Review the highlighted agenda fields.",
      errors: { startsAt: ["Choose a real local time in the event time zone."] },
      values,
    };
  }

  const client = getDatabaseClient();
  const session = await new ProgramSessionRepository(client).get(event.id, parsed.data.sessionId);
  if (!session || session.archivedAt !== null) {
    return { status: "error", message: "This session is not available for scheduling." };
  }
  const repository = new AgendaPlacementRepository(client);
  const details = {
    startsAt,
    durationMinutes: parsed.data.durationMinutes,
    roomId: parsed.data.roomId,
    trackIds: parsed.data.trackId === "" || parsed.data.trackId === "unassigned" ? [] : [parsed.data.trackId],
    speakerIds: session.version.speakerIds,
  };
  const options = {
    policy: parsed.data.conflictPolicy as AgendaConflictPolicy,
    conflictsConfirmed: parsed.data.conflictsConfirmed,
  };

  try {
    const placement =
      parsed.data.placementId === ""
        ? await repository.place({ eventId: event.id, sessionId: session.id, ...details }, options)
        : await repository.update(
            event.id,
            parsed.data.placementId,
            { expectedVersion: parsed.data.expectedVersion, ...details },
            options,
          );
    await emitWebhookEvent(client, {
      eventId: event.id,
      type: "session.scheduled",
      data: {
        sessionId: placement.sessionId,
        placementId: placement.id,
        startsAt: placement.startsAt.toISOString(),
        durationMinutes: placement.durationMinutes,
      },
    });
    revalidatePath(`/dashboard/events/${event.slug}/agenda`);
    return {
      status: "success",
      message: parsed.data.placementId === "" ? "Session added to the agenda." : "Agenda placement saved.",
      sessionId: placement.sessionId,
    };
  } catch (error) {
    if (error instanceof AgendaConflictError) {
      return {
        status: "conflict",
        message: error.message,
        sessionId: session.id,
        confirmationRequired: error.confirmationRequired,
        values,
        conflicts: error.conflicts.map((conflict) => ({
          type: conflict.type,
          placementIds: [...conflict.placementIds],
          resourceId: conflict.resourceId,
          startsAt: conflict.overlap.startsAt.toISOString(),
          endsAt: conflict.overlap.endsAt.toISOString(),
          explanation: conflict.explanation,
        })),
      };
    }
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}

export async function removeAgendaPlacement(
  eventSlug: string,
  placementId: string,
  expectedVersion: number,
): Promise<AgendaMutationState> {
  if (!z.uuid().safeParse(placementId).success || !Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    return { status: "error", message: "The agenda placement is invalid." };
  }
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    await new AgendaPlacementRepository(getDatabaseClient()).remove(event.id, placementId, expectedVersion);
    revalidatePath(`/dashboard/events/${event.slug}/agenda`);
    return { status: "success", message: "Session removed from the agenda." };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}
