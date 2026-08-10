"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import {
  AgendaConflictError,
  type AgendaConflictPolicy,
  AgendaPlacementRepository,
  type AgendaProposalPlan,
  proposeAgendaSchedule,
} from "@/server/agenda";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { AuthorizationError } from "@/server/authorization/policy";
import { getRequestPrincipal } from "@/server/authorization/request-context";
import { getDatabaseClient } from "@/server/database/client";
import { emitWebhookEvent } from "@/server/developer-api/webhooks";
import { RepositoryError } from "@/server/events/repositories";
import { PublishedProgramOperations, PublishedProgramRepository } from "@/server/published-program";
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
  if (!(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;
  return getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true, timezone: true, startsAt: true, endsAt: true },
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

export interface AssistedScheduleProposalState {
  readonly sessionId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationMinutes: number;
  readonly roomId: string;
  readonly roomName: string;
}

export interface AssistedScheduleState {
  readonly status: "idle" | "preview" | "success" | "error";
  readonly message?: string;
  readonly proposals?: readonly AssistedScheduleProposalState[];
  readonly unplaced?: readonly { readonly sessionId: string; readonly title: string; readonly reason: string }[];
}

const assistedProposalSchema = z
  .array(
    z.object({
      sessionId: z.string().uuid(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      durationMinutes: z.number().int().positive(),
      roomId: z.string().uuid(),
    }),
  )
  .max(500);

function serializeProposalPlan(plan: AgendaProposalPlan): {
  readonly proposals: readonly AssistedScheduleProposalState[];
  readonly unplaced: readonly { readonly sessionId: string; readonly title: string; readonly reason: string }[];
} {
  return {
    proposals: plan.proposals.map(({ sessionId, title, startsAt, endsAt, durationMinutes, roomId, roomName }) => ({
      sessionId,
      title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      durationMinutes,
      roomId,
      roomName,
    })),
    unplaced: plan.unplaced.map((session) => ({ ...session })),
  };
}

async function buildAssistedSchedulePlan(event: NonNullable<Awaited<ReturnType<typeof authorizedEvent>>>) {
  const client = getDatabaseClient();
  const [sessionPage, placementPage, rooms] = await Promise.all([
    new ProgramSessionRepository(client).listPage(event.id),
    new AgendaPlacementRepository(client).listPage(event.id),
    client.room.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  if (sessionPage.hasMore || placementPage.hasMore) {
    return { error: "Assisted scheduling is unavailable while this agenda is only partially loaded." } as const;
  }
  return {
    plan: proposeAgendaSchedule(
      { startsAt: event.startsAt, endsAt: event.endsAt },
      sessionPage.items.map((session) => ({
        id: session.id,
        title: session.version.title,
        durationMinutes: session.version.durationMinutes,
        parentSessionId: session.parentSessionId,
        trackIds: session.version.trackId ? [session.version.trackId] : [],
        speakerIds: session.version.speakerIds,
      })),
      rooms.map(({ id, name }) => ({ id, name })),
      placementPage.items.map((placement) => ({
        sessionId: placement.sessionId,
        startsAt: placement.startsAt,
        endsAt: placement.endsAt,
        roomId: placement.roomId,
        trackIds: placement.trackIds,
        speakerIds: placement.speakerIds,
      })),
    ),
  } as const;
}

function proposalFingerprint(
  proposals: readonly Pick<
    AssistedScheduleProposalState,
    "sessionId" | "startsAt" | "endsAt" | "durationMinutes" | "roomId"
  >[],
): string {
  return JSON.stringify(
    proposals.map(({ sessionId, startsAt, endsAt, durationMinutes, roomId }) => ({
      sessionId,
      startsAt,
      endsAt,
      durationMinutes,
      roomId,
    })),
  );
}

export async function previewAssistedSchedule(eventSlug: string): Promise<AssistedScheduleState> {
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const result = await buildAssistedSchedulePlan(event);
  if ("error" in result) return { status: "error", message: result.error };
  const serialized = serializeProposalPlan(result.plan);
  return {
    status: "preview",
    message:
      serialized.proposals.length === 0
        ? "No conflict-free placements are available."
        : `Review ${serialized.proposals.length} proposed ${serialized.proposals.length === 1 ? "placement" : "placements"}.`,
    ...serialized,
  };
}

export async function acceptAssistedSchedule(
  eventSlug: string,
  expectedProposals: readonly AssistedScheduleProposalState[],
): Promise<AssistedScheduleState> {
  const parsed = assistedProposalSchema.safeParse(expectedProposals);
  if (!parsed.success || parsed.data.length === 0) {
    return { status: "error", message: "Preview a valid assisted schedule before accepting it." };
  }
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const result = await buildAssistedSchedulePlan(event);
  if ("error" in result) return { status: "error", message: result.error };
  const serialized = serializeProposalPlan(result.plan);
  if (proposalFingerprint(parsed.data) !== proposalFingerprint(serialized.proposals ?? [])) {
    return { status: "error", message: "The agenda changed after this preview. Generate a new proposal." };
  }

  const client = getDatabaseClient();
  const repository = new AgendaPlacementRepository(client);
  // Each placement is saved in its own transaction, so a mid-batch failure leaves the earlier ones
  // persisted; revalidate either way so the agenda never renders without placements that were saved.
  let saved = 0;
  try {
    for (const proposal of result.plan.proposals) {
      const placement = await repository.place(
        {
          eventId: event.id,
          sessionId: proposal.sessionId,
          startsAt: proposal.startsAt,
          durationMinutes: proposal.durationMinutes,
          roomId: proposal.roomId,
          trackIds: proposal.trackIds,
          speakerIds: proposal.speakerIds,
        },
        { policy: "prevent" },
      );
      saved += 1;
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
    }
  } catch (error) {
    revalidatePath(`/dashboard/events/${event.slug}/agenda`);
    if (error instanceof RepositoryError) {
      return {
        status: "error",
        message:
          saved === 0
            ? "The agenda changed while saving. Reload it before trying again."
            : `Only ${saved} of ${result.plan.proposals.length} placements were saved before the agenda changed. Reload it before trying again.`,
      };
    }
    throw error;
  }

  revalidatePath(`/dashboard/events/${event.slug}/agenda`);
  return {
    status: "success",
    message: `${result.plan.proposals.length} ${result.plan.proposals.length === 1 ? "placement was" : "placements were"} added to the agenda.`,
  };
}

export interface ProgramPublicationMutationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

const publicationSchema = z.object({
  eventSlug: z.string().trim().min(1),
  intent: z.enum(["publish", "republish", "unpublish"]),
  expectedVersion: z.coerce.number().int().min(0),
});

export async function mutateProgramPublication(
  _previousState: ProgramPublicationMutationState,
  formData: FormData,
): Promise<ProgramPublicationMutationState> {
  const parsed = publicationSchema.safeParse({
    eventSlug: stringValue(formData, "eventSlug"),
    intent: stringValue(formData, "intent"),
    expectedVersion: stringValue(formData, "expectedVersion"),
  });
  if (!parsed.success) return { status: "error", message: "Reload this agenda and try again." };

  const event = await getDatabaseClient().event.findUnique({
    where: { slug: parsed.data.eventSlug },
    select: { id: true, slug: true },
  });
  if (!event) return { status: "error", message: "This event is not available." };

  const operations = new PublishedProgramOperations(
    new PublishedProgramRepository(getDatabaseClient()),
    getRequestPrincipal,
  );
  try {
    const { intent, expectedVersion } = parsed.data;
    let published: Awaited<ReturnType<typeof operations.publish>>;
    if (intent === "publish") published = await operations.publish(event.id, expectedVersion);
    else if (intent === "republish") published = await operations.republish(event.id, expectedVersion);
    else published = await operations.unpublish(event.id, expectedVersion);
    revalidatePath(`/dashboard/events/${event.slug}/agenda`);
    revalidatePath(`/dashboard/events/${event.slug}/integrations`);
    return {
      status: "success",
      message:
        intent === "unpublish"
          ? `Program version ${published.versionNumber} unpublished. Public program views are offline.`
          : `Program version ${published.versionNumber} published.`,
    };
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "This event is not available." };
    if (error instanceof RepositoryError) {
      if (error.code === "conflict") {
        return { status: "error", message: "The published program changed. Reload this agenda and try again." };
      }
      return { status: "error", message: error.message };
    }
    throw error;
  }
}
