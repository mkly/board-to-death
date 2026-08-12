"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { SpeakerSourcingRepository } from "@/server/speaker-sourcing/repositories";

const uuid = z.uuid();

function sourcingPath(eventSlug: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/speaker-sourcing`;
}

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function authorizedContext(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;
  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, name: true, slug: true },
  });
  if (!event) return null;
  return { event, actorLabel: session.user.name || session.user.email };
}

export interface SpeakerSourcingActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

function failure(message: string): SpeakerSourcingActionState {
  return { status: "error", message };
}

async function runMutation(
  eventSlug: string,
  operation: (context: NonNullable<Awaited<ReturnType<typeof authorizedContext>>>) => Promise<string>,
): Promise<SpeakerSourcingActionState> {
  const context = await authorizedContext(eventSlug);
  if (!context) return failure("This event is not available.");
  try {
    const message = await operation(context);
    revalidatePath(sourcingPath(eventSlug));
    return { status: "success", message };
  } catch (error) {
    if (error instanceof RepositoryError) return failure(error.message);
    throw error;
  }
}

export async function createInterestFormAction(
  eventSlug: string,
  _previousState: SpeakerSourcingActionState,
  formData: FormData,
): Promise<SpeakerSourcingActionState> {
  return runMutation(eventSlug, async ({ event }) => {
    await new SpeakerSourcingRepository(getDatabaseClient()).createInterestForm({
      eventId: event.id,
      title: stringValue(formData, "title"),
      description: stringValue(formData, "description"),
    });
    return "Speaker interest form published.";
  });
}

export async function enrollProspectAction(
  eventSlug: string,
  _previousState: SpeakerSourcingActionState,
  formData: FormData,
): Promise<SpeakerSourcingActionState> {
  const personId = uuid.safeParse(stringValue(formData, "personId"));
  if (!personId.success) return failure("Select a directory person to enroll.");
  return runMutation(eventSlug, async ({ event, actorLabel }) => {
    await new SpeakerSourcingRepository(getDatabaseClient()).enrollManual({
      eventId: event.id,
      personId: personId.data,
      actorLabel,
    });
    return "Prospect enrolled in the sourcing pipeline.";
  });
}

export async function moveProspectAction(
  eventSlug: string,
  prospectId: string,
  _previousState: SpeakerSourcingActionState,
  formData: FormData,
): Promise<SpeakerSourcingActionState> {
  const ids = z.object({ prospectId: uuid, stageId: uuid }).safeParse({
    prospectId,
    stageId: stringValue(formData, "stageId"),
  });
  if (!ids.success) return failure("Select a valid prospect stage.");
  return runMutation(eventSlug, async ({ event, actorLabel }) => {
    await new SpeakerSourcingRepository(getDatabaseClient()).moveProspect(
      event.id,
      ids.data.prospectId,
      ids.data.stageId,
      actorLabel,
    );
    return "Prospect stage updated.";
  });
}

export async function addProspectNoteAction(
  eventSlug: string,
  prospectId: string,
  _previousState: SpeakerSourcingActionState,
  formData: FormData,
): Promise<SpeakerSourcingActionState> {
  const parsedId = uuid.safeParse(prospectId);
  if (!parsedId.success) return failure("The selected prospect is invalid.");
  return runMutation(eventSlug, async ({ event, actorLabel }) => {
    await new SpeakerSourcingRepository(getDatabaseClient()).addNote(
      event.id,
      parsedId.data,
      stringValue(formData, "note"),
      actorLabel,
    );
    return "Internal note added.";
  });
}

export async function assignProspectAction(eventSlug: string, prospectId: string): Promise<SpeakerSourcingActionState> {
  const parsedId = uuid.safeParse(prospectId);
  if (!parsedId.success) return failure("The selected prospect is invalid.");
  return runMutation(eventSlug, async ({ event, actorLabel }) => {
    await new SpeakerSourcingRepository(getDatabaseClient()).assignToEvent(event.id, parsedId.data, actorLabel);
    return `Prospect assigned to ${event.name} and added to event contacts.`;
  });
}

export async function configureStagesAction(
  eventSlug: string,
  _previousState: SpeakerSourcingActionState,
  formData: FormData,
): Promise<SpeakerSourcingActionState> {
  const stageIds = formData.getAll("stageId").filter((value): value is string => typeof value === "string");
  const stageNames = formData.getAll("stageName").filter((value): value is string => typeof value === "string");
  const stagePositions = formData
    .getAll("stagePosition")
    .map((value) => (typeof value === "string" ? Number(value) : Number.NaN));
  if (
    stagePositions.length !== stageIds.length ||
    new Set(stagePositions).size !== stagePositions.length ||
    stagePositions.some((position) => !Number.isInteger(position) || position < 0 || position >= stageIds.length)
  ) {
    return failure("Choose a unique position for every pipeline stage.");
  }
  const stages = stageIds
    .map((id, index) => ({ id, name: stageNames[index] ?? "", position: stagePositions[index] }))
    .sort((left, right) => left.position - right.position)
    .map(({ id, name }) => ({ id, name }));
  return runMutation(eventSlug, async ({ event }) => {
    await new SpeakerSourcingRepository(getDatabaseClient()).configureStages(event.id, stages);
    return "Pipeline stage names and order saved.";
  });
}
