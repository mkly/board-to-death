"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { CustomFieldEntityType, CustomFieldType, ProgramSessionParticipantRole } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { type PreparedCustomFieldFile, prepareCustomFieldFile, putCustomFieldFile } from "@/server/custom-fields/files";
import { parseCustomFieldFormData } from "@/server/custom-fields/form-values";
import { CustomFieldRepository, validateCustomFieldValue } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { createFileStorage } from "@/server/infrastructure";
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
  if (!session || !(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;
  const event = await getDatabaseClient().event.findFirst({
    where: { slug: eventSlug, archivedAt: null },
    select: { id: true, slug: true },
  });
  return event ? { ...event, actorLabel: session.user.name?.trim() || session.user.email } : null;
}

function repositoryMessage(error: RepositoryError): string {
  if (error.code === "not-found") {
    return "This session, version, track, or participant is not available for this event.";
  }
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
  const customFields = new CustomFieldRepository(getDatabaseClient());
  const definitions = await customFields.listDefinitions(event.id, CustomFieldEntityType.PROGRAM_SESSION);
  let customInput: ReturnType<typeof parseCustomFieldFormData>;
  let existingValues: Awaited<ReturnType<CustomFieldRepository["listValues"]>> = [];
  let files: readonly { definition: (typeof definitions)[number]; prepared: PreparedCustomFieldFile }[];
  try {
    customInput = parseCustomFieldFormData(formData, definitions);
    for (const entry of customInput.values) validateCustomFieldValue(entry.definition, entry.value);
    if (parsed.data.sessionId !== "") {
      existingValues = await customFields.listValues(event.id, {
        entityType: CustomFieldEntityType.PROGRAM_SESSION,
        sessionId: parsed.data.sessionId,
      });
    }
    const uploadedDefinitionIds = new Set(customInput.files.map(({ definition }) => definition.id));
    const missingRequiredFile = definitions.find(
      (definition) =>
        definition.type === CustomFieldType.FILE &&
        definition.required &&
        !uploadedDefinitionIds.has(definition.id) &&
        !existingValues.some((stored) => stored.definitionId === definition.id),
    );
    if (missingRequiredFile) return { status: "error", message: `${missingRequiredFile.label} is required.` };
    files = await Promise.all(
      customInput.files.map(async ({ definition, file }) => ({
        definition,
        prepared: await prepareCustomFieldFile(file, definition.label),
      })),
    );
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
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
    createdBy: event.actorLabel,
  };

  try {
    const saved =
      parsed.data.sessionId === ""
        ? await repository.createManual({ eventId: event.id, ...input })
        : await repository.update(event.id, parsed.data.sessionId, input);
    const target = { entityType: CustomFieldEntityType.PROGRAM_SESSION, sessionId: saved.id } as const;
    for (const entry of customInput.values) {
      await customFields.setValue(event.id, entry.definition.id, target, entry.value);
    }
    const storage = createFileStorage({
      driver: "local",
      rootDirectory: getRuntimeConfig().server.FILE_STORAGE_PATH,
    });
    for (const { definition, prepared } of files) {
      const stored = await putCustomFieldFile({
        eventId: event.id,
        definitionId: definition.id,
        fieldLabel: definition.label,
        pathSegment: `sessions/${saved.id}`,
        prepared,
        storage,
      });
      try {
        await customFields.setValue(event.id, definition.id, target, stored);
      } catch (error) {
        await storage.delete(stored.objectKey);
        throw error;
      }
      const previous = existingValues.find(({ definitionId }) => definitionId === definition.id)?.value;
      if (typeof previous === "object" && previous !== null && !Array.isArray(previous) && "objectKey" in previous) {
        const previousKey = previous.objectKey;
        if (typeof previousKey === "string" && previousKey !== stored.objectKey) await storage.delete(previousKey);
      }
    }
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

export async function restoreProgramSessionContent(
  eventSlug: string,
  sessionId: string,
  versionNumber: number,
): Promise<SessionMutationState> {
  if (!z.uuid().safeParse(sessionId).success || !z.number().int().positive().safeParse(versionNumber).success) {
    return { status: "error", message: "The selected session version is invalid." };
  }
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    const restored = await new ProgramSessionRepository(getDatabaseClient()).restoreContentVersion(
      event.id,
      sessionId,
      versionNumber,
      event.actorLabel,
    );
    revalidatePath(`/dashboard/events/${event.slug}/sessions`);
    return {
      status: "success",
      message: `Version ${versionNumber} restored as version ${restored.version.versionNumber}.`,
      sessionId,
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
