"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { ProgramSessionParticipantRole } from "@/generated/prisma/client";
import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { ProgramSessionRepository } from "@/server/sessions/repositories";

export interface SessionMutationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly sessionId?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const sessionFormSchema = z
  .object({
    eventSlug: z.string().trim().min(1),
    sessionId: z.string().trim(),
    title: z.string().trim().min(1, "Enter a session title.").max(200, "Keep the title under 200 characters."),
    description: z.string().trim().max(5_000, "Keep the description under 5,000 characters."),
    durationMinutes: z.coerce
      .number({ error: "Enter a duration in minutes." })
      .int("Duration must be a whole number of minutes.")
      .min(1, "Duration must be at least one minute.")
      .max(1_440, "Duration cannot exceed 1,440 minutes."),
    trackId: z.string().trim(),
    parentSessionId: z.string().trim(),
    participants: z.array(
      z.object({
        speakerId: z.string().uuid("A selected participant is invalid."),
        role: z.enum(ProgramSessionParticipantRole),
      }),
    ),
  })
  .superRefine(({ parentSessionId, sessionId, participants, trackId }, context) => {
    if (sessionId !== "" && !z.uuid().safeParse(sessionId).success) {
      context.addIssue({ code: "custom", path: ["sessionId"], message: "The selected session is invalid." });
    }
    if (trackId !== "" && trackId !== "unassigned" && !z.uuid().safeParse(trackId).success) {
      context.addIssue({ code: "custom", path: ["trackId"], message: "The selected track is invalid." });
    }
    if (parentSessionId !== "" && parentSessionId !== "standalone" && !z.uuid().safeParse(parentSessionId).success) {
      context.addIssue({ code: "custom", path: ["parentSessionId"], message: "The parent session is invalid." });
    }
    if (parentSessionId === sessionId) {
      context.addIssue({ code: "custom", path: ["parentSessionId"], message: "A session cannot be its own parent." });
    }
    if (new Set(participants.map(({ speakerId }) => speakerId)).size !== participants.length) {
      context.addIssue({ code: "custom", path: ["participants"], message: "Select each participant once." });
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

function participantValues(formData: FormData) {
  return [...formData.entries()].flatMap(([name, value]) => {
    if (!name.startsWith("participantRole:") || typeof value !== "string" || value === "NONE") return [];
    return [{ speakerId: name.slice("participantRole:".length), role: value }];
  });
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) return null;
  return getDatabaseClient().event.findFirst({
    where: { slug: eventSlug, archivedAt: null },
    select: { id: true, slug: true },
  });
}

function repositoryMessage(error: RepositoryError): string {
  if (error.code === "not-found") return "This session, track, or participant is not available for this event.";
  return error.message;
}

export async function saveProgramSession(
  _previousState: SessionMutationState,
  formData: FormData,
): Promise<SessionMutationState> {
  const parsed = sessionFormSchema.safeParse({
    eventSlug: stringValue(formData, "eventSlug"),
    sessionId: stringValue(formData, "sessionId"),
    title: stringValue(formData, "title"),
    description: stringValue(formData, "description"),
    durationMinutes: stringValue(formData, "durationMinutes"),
    trackId: stringValue(formData, "trackId"),
    parentSessionId: stringValue(formData, "parentSessionId"),
    participants: participantValues(formData),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted session fields.",
      errors: validationErrors(parsed.error),
    };
  }

  const event = await authorizedEvent(parsed.data.eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  const repository = new ProgramSessionRepository(getDatabaseClient());
  const input = {
    title: parsed.data.title,
    description: parsed.data.description === "" ? null : parsed.data.description,
    durationMinutes: parsed.data.durationMinutes,
    trackId: parsed.data.trackId === "unassigned" || parsed.data.trackId === "" ? null : parsed.data.trackId,
    parentSessionId:
      parsed.data.parentSessionId === "standalone" || parsed.data.parentSessionId === ""
        ? null
        : parsed.data.parentSessionId,
    participants: parsed.data.participants,
  };

  try {
    const saved =
      parsed.data.sessionId === ""
        ? await repository.createManual({ eventId: event.id, ...input })
        : await repository.update(event.id, parsed.data.sessionId, input);
    revalidatePath(`/dashboard/events/${event.slug}/sessions`);
    return {
      status: "success",
      message: parsed.data.sessionId === "" ? "Manual session created." : "Session changes saved.",
      sessionId: saved.id,
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}

export async function archiveProgramSession(eventSlug: string, sessionId: string): Promise<SessionMutationState> {
  if (!z.uuid().safeParse(sessionId).success) {
    return { status: "error", message: "The selected session is invalid." };
  }
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    await new ProgramSessionRepository(getDatabaseClient()).archive(event.id, sessionId);
    revalidatePath(`/dashboard/events/${event.slug}/sessions`);
    return { status: "success", message: "Session archived.", sessionId };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}

export async function cloneProgramSession(eventSlug: string, sessionId: string): Promise<SessionMutationState> {
  if (!z.uuid().safeParse(sessionId).success) {
    return { status: "error", message: "The selected session is invalid." };
  }
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    const cloned = await new ProgramSessionRepository(getDatabaseClient()).clone(event.id, sessionId);
    revalidatePath(`/dashboard/events/${event.slug}/sessions`);
    return { status: "success", message: "Session cloned as an unscheduled manual session.", sessionId: cloned.id };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}
