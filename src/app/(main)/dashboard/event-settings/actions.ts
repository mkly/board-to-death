"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { EventType } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getRequestAuthorization } from "@/server/authorization/request-context";
import { getDatabaseClient } from "@/server/database";
import { EventRepository, RepositoryError, RoomRepository, TrackRepository } from "@/server/events";

import type { EventSettingsSnapshot, MutationResult } from "./types";

const eventSchema = z
  .object({
    name: z.string().trim().min(1, "Event name is required."),
    slug: z
      .string()
      .trim()
      .min(1, "Slug is required.")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens."),
    type: z.enum(EventType),
    websiteUrl: z.union([z.literal(""), z.url("Enter a valid website URL.")]),
    location: z.string().trim(),
    timezone: z.string().trim().min(1, "Time zone is required."),
    startsAt: z.string().min(1, "Start date and time are required."),
    endsAt: z.string().min(1, "End date and time are required."),
    theme: z.string().trim(),
    exhibitorsEnabled: z.boolean(),
    sponsorsEnabled: z.boolean(),
    logoObjectKey: z.string().trim(),
    backgroundObjectKey: z.string().trim(),
  })
  .superRefine((value, context) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).format();
    } catch {
      context.addIssue({ code: "custom", path: ["timezone"], message: "Enter a valid IANA time zone." });
      return;
    }

    try {
      const startsAt = localDateTimeToInstant(value.startsAt, value.timezone);
      const endsAt = localDateTimeToInstant(value.endsAt, value.timezone);
      if (Temporal.Instant.compare(startsAt, endsAt) >= 0) {
        context.addIssue({ code: "custom", path: ["endsAt"], message: "End must be later than start." });
      }
    } catch {
      context.addIssue({ code: "custom", path: ["startsAt"], message: "Enter valid local date and time values." });
    }
  });

const namedItemSchema = z.object({ name: z.string().trim().min(1, "Name is required.").max(120) });
const trackSchema = namedItemSchema.extend({
  color: z.enum(["slate", "rose", "orange", "amber", "emerald", "sky", "indigo", "violet"]),
});
const cloneEventSchema = z.object({
  name: z.string().trim().min(1, "Event name is required.").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens."),
  rooms: z.boolean(),
  tracks: z.boolean(),
  forms: z.boolean(),
  tasks: z.boolean(),
  templates: z.boolean(),
  portalSettings: z.boolean(),
});

function repositories() {
  const database = getDatabaseClient();
  return {
    events: new EventRepository(database),
    rooms: new RoomRepository(database),
    tracks: new TrackRepository(database),
  };
}

function localDateTimeToInstant(value: string, timezone: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(value).toZonedDateTime(timezone, { disambiguation: "reject" }).toInstant();
}

function parseEventForm(formData: FormData) {
  return eventSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    type: formData.get("type"),
    websiteUrl: formData.get("websiteUrl"),
    location: formData.get("location"),
    timezone: formData.get("timezone"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    theme: formData.get("theme"),
    exhibitorsEnabled: formData.get("exhibitorsEnabled") === "on",
    sponsorsEnabled: formData.get("sponsorsEnabled") === "on",
    logoObjectKey: formData.get("logoObjectKey"),
    backgroundObjectKey: formData.get("backgroundObjectKey"),
  });
}

function eventInput(value: z.infer<typeof eventSchema>) {
  return {
    ...value,
    websiteUrl: value.websiteUrl || null,
    location: value.location || null,
    startsAt: new Date(localDateTimeToInstant(value.startsAt, value.timezone).epochMilliseconds),
    endsAt: new Date(localDateTimeToInstant(value.endsAt, value.timezone).epochMilliseconds),
    theme: value.theme || null,
    logoObjectKey: value.logoObjectKey || null,
    backgroundObjectKey: value.backgroundObjectKey || null,
  };
}

function invalidResult(error: z.ZodError): MutationResult {
  return { ok: false, message: "Review the highlighted fields.", fieldErrors: error.flatten().fieldErrors };
}

function failureResult(error: unknown): MutationResult {
  if (error instanceof RepositoryError) {
    return { ok: false, message: error.message };
  }
  console.error(error);
  return { ok: false, message: "The settings could not be saved. Try again." };
}

async function isAuthorizedAdmin(eventId?: string): Promise<boolean> {
  return isAuthorizedAdminSession(
    await auth.api.getSession({ headers: await headers() }),
    eventId ? { id: eventId } : undefined,
  );
}

async function snapshot(eventId: string): Promise<EventSettingsSnapshot> {
  const { events, rooms, tracks } = repositories();
  const [event, eventRooms, eventTracks] = await Promise.all([
    events.get(eventId),
    rooms.list(eventId),
    tracks.list(eventId),
  ]);
  if (!event) {
    throw new RepositoryError("not-found", "The event was not found.");
  }
  return {
    event: {
      ...event,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      archivedAt: event.archivedAt?.toISOString() ?? null,
    },
    rooms: eventRooms.map(({ id, name, sortOrder }) => ({ id, name, sortOrder })),
    tracks: eventTracks.map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder })),
  };
}

export async function cloneEvent(sourceEventId: string, formData: FormData): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(sourceEventId)))
    return { ok: false, message: "You are not authorized to clone events." };
  const parsed = cloneEventSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    rooms: formData.get("rooms") === "on",
    tracks: formData.get("tracks") === "on",
    forms: formData.get("forms") === "on",
    tasks: formData.get("tasks") === "on",
    templates: formData.get("templates") === "on",
    portalSettings: formData.get("portalSettings") === "on",
  });
  if (!parsed.success) return invalidResult(parsed.error);
  try {
    const { name, slug, ...options } = parsed.data;
    const event = await repositories().events.clone(sourceEventId, { name, slug, options });
    return success(event.id, "Event cloned. Submissions and contacts were not copied.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function archiveEvent(eventId: string): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to archive events." };
  try {
    await repositories().events.archive(eventId);
    return success(eventId, "Event archived and is now read-only.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function restoreEvent(eventId: string): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to restore events." };
  try {
    await repositories().events.restore(eventId);
    return success(eventId, "Event restored.");
  } catch (error) {
    return failureResult(error);
  }
}

async function success(eventId: string, message: string): Promise<MutationResult> {
  revalidatePath("/dashboard/event-settings");
  return { ok: true, message, snapshot: await snapshot(eventId) };
}

export async function createEvent(formData: FormData): Promise<MutationResult> {
  const authorization = await getRequestAuthorization();
  if (!authorization?.activeOrganization) return { ok: false, message: "You are not authorized to create events." };
  const parsed = parseEventForm(formData);
  if (!parsed.success) return invalidResult(parsed.error);
  try {
    const event = await repositories().events.create({
      ...eventInput(parsed.data),
      orgId: authorization.activeOrganization.id,
    });
    return success(event.id, "Event created.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function updateEvent(eventId: string, formData: FormData): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to edit this event." };
  const parsed = parseEventForm(formData);
  if (!parsed.success) return invalidResult(parsed.error);
  try {
    await repositories().events.update(eventId, eventInput(parsed.data));
    return success(eventId, "Event settings saved.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function createRoom(eventId: string, formData: FormData): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to edit this event." };
  const parsed = namedItemSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return invalidResult(parsed.error);
  try {
    await repositories().rooms.create({ eventId, name: parsed.data.name });
    return success(eventId, "Room added.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function updateRoom(eventId: string, roomId: string, formData: FormData): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to edit this event." };
  const parsed = namedItemSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return invalidResult(parsed.error);
  try {
    await repositories().rooms.update(eventId, roomId, parsed.data.name);
    return success(eventId, "Room renamed.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function deleteRoom(eventId: string, roomId: string): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to edit this event." };
  try {
    await repositories().rooms.delete(eventId, roomId);
    return success(eventId, "Room removed.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function moveRoom(eventId: string, roomId: string, offset: -1 | 1): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to edit this event." };
  try {
    const repository = repositories().rooms;
    const rows = await repository.list(eventId);
    const index = rows.findIndex(({ id }) => id === roomId);
    const destination = index + offset;
    if (index < 0 || destination < 0 || destination >= rows.length) {
      return { ok: false, message: "That room cannot move any farther." };
    }
    const ids = rows.map(({ id }) => id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    await repository.reorder(eventId, ids);
    return success(eventId, "Room order updated.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function createTrack(eventId: string, formData: FormData): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to edit this event." };
  const parsed = trackSchema.safeParse({ name: formData.get("name"), color: formData.get("color") });
  if (!parsed.success) return invalidResult(parsed.error);
  try {
    await repositories().tracks.create({ eventId, ...parsed.data });
    return success(eventId, "Track added.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function updateTrack(eventId: string, trackId: string, formData: FormData): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to edit this event." };
  const parsed = trackSchema.safeParse({ name: formData.get("name"), color: formData.get("color") });
  if (!parsed.success) return invalidResult(parsed.error);
  try {
    await repositories().tracks.update(eventId, trackId, parsed.data);
    return success(eventId, "Track updated.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function deleteTrack(eventId: string, trackId: string): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to edit this event." };
  try {
    await repositories().tracks.delete(eventId, trackId);
    return success(eventId, "Track removed.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function moveTrack(eventId: string, trackId: string, offset: -1 | 1): Promise<MutationResult> {
  if (!(await isAuthorizedAdmin(eventId))) return { ok: false, message: "You are not authorized to edit this event." };
  try {
    const repository = repositories().tracks;
    const rows = await repository.list(eventId);
    const index = rows.findIndex(({ id }) => id === trackId);
    const destination = index + offset;
    if (index < 0 || destination < 0 || destination >= rows.length) {
      return { ok: false, message: "That track cannot move any farther." };
    }
    const ids = rows.map(({ id }) => id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    await repository.reorder(eventId, ids);
    return success(eventId, "Track order updated.");
  } catch (error) {
    return failureResult(error);
  }
}
