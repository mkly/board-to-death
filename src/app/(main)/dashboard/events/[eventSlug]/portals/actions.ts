"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import {
  PORTAL_ACCENT_COLORS,
  PORTAL_CONTENT_KEYS,
  PORTAL_GROUP_KINDS,
  PORTAL_PARTICIPANT_ROLES,
  PORTAL_PROFILE_FIELDS,
  PORTAL_SUBMISSION_STATUSES,
} from "@/server/participant-portals";

export interface PortalMutationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly portalId?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const portalSchema = z.object({
  eventSlug: z.string().trim().min(1),
  portalId: z.union([z.literal(""), z.uuid()]),
  name: z.string().trim().min(1, "Enter a portal name.").max(120),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a portal slug.")
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens."),
  welcomeMessage: z.string().trim().max(1_000),
  accentColor: z.enum(PORTAL_ACCENT_COLORS),
  logoObjectKey: z.string().trim().max(500),
  backgroundObjectKey: z.string().trim().max(500),
  isDefault: z.boolean(),
  roles: z.array(z.enum(PORTAL_PARTICIPANT_ROLES)),
  submissionStatuses: z.array(z.enum(PORTAL_SUBMISSION_STATUSES)),
  groupKinds: z.array(z.enum(PORTAL_GROUP_KINDS)),
  sectionTitles: z.object({
    submissions: z.string().trim().min(1).max(80),
    profile: z.string().trim().min(1).max(80),
    tasks: z.string().trim().min(1).max(80),
    sessions: z.string().trim().min(1).max(80),
    resources: z.string().trim().min(1).max(80),
  }),
});

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function selectedValues(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === "string");
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
  return getDatabaseClient().event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
}

function portalPath(eventSlug: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/portals`;
}

export async function saveParticipantPortal(
  _previousState: PortalMutationState,
  formData: FormData,
): Promise<PortalMutationState> {
  const parsed = portalSchema.safeParse({
    eventSlug: stringValue(formData, "eventSlug"),
    portalId: stringValue(formData, "portalId"),
    name: stringValue(formData, "name"),
    slug: stringValue(formData, "slug"),
    welcomeMessage: stringValue(formData, "welcomeMessage"),
    accentColor: stringValue(formData, "accentColor"),
    logoObjectKey: stringValue(formData, "logoObjectKey"),
    backgroundObjectKey: stringValue(formData, "backgroundObjectKey"),
    isDefault: formData.get("isDefault") === "on",
    roles: selectedValues(formData, "roles"),
    submissionStatuses: selectedValues(formData, "submissionStatuses"),
    groupKinds: selectedValues(formData, "groupKinds"),
    sectionTitles: {
      submissions: stringValue(formData, "title-submissions"),
      profile: stringValue(formData, "title-profile"),
      tasks: stringValue(formData, "title-tasks"),
      sessions: stringValue(formData, "title-sessions"),
      resources: stringValue(formData, "title-resources"),
    },
  });
  if (!parsed.success)
    return { status: "error", message: "Review the highlighted fields.", errors: validationErrors(parsed.error) };
  const event = await authorizedEvent(parsed.data.eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  const contentVisibility = Object.fromEntries(
    PORTAL_CONTENT_KEYS.map((key) => [key, formData.get(`content-${key}`) === "on"]),
  );
  const profileFieldVisibility = Object.fromEntries(
    PORTAL_PROFILE_FIELDS.map((field) => {
      const mode = stringValue(formData, `field-${field}`);
      return [field, ["editable", "view", "hidden"].includes(mode) ? mode : "editable"];
    }),
  );
  const data = {
    name: parsed.data.name,
    slug: parsed.data.slug,
    welcomeMessage: parsed.data.welcomeMessage || null,
    accentColor: parsed.data.accentColor,
    logoObjectKey: parsed.data.logoObjectKey || null,
    backgroundObjectKey: parsed.data.backgroundObjectKey || null,
    sectionTitles: parsed.data.sectionTitles,
    audienceRules: {
      roles: parsed.data.roles,
      submissionStatuses: parsed.data.submissionStatuses,
      groupKinds: parsed.data.groupKinds,
    },
    contentVisibility,
    profileFieldVisibility,
  };

  try {
    const database = getDatabaseClient();
    const portal = await database.$transaction(async (transaction) => {
      const existingCount = await transaction.participantPortal.count({ where: { eventId: event.id } });
      const makeDefault = parsed.data.isDefault || existingCount === 0;
      if (makeDefault)
        await transaction.participantPortal.updateMany({ where: { eventId: event.id }, data: { isDefault: false } });
      if (parsed.data.portalId) {
        return transaction.participantPortal.update({
          where: { eventId_id: { eventId: event.id, id: parsed.data.portalId } },
          data: { ...data, isDefault: makeDefault },
        });
      }
      const maximum = await transaction.participantPortal.aggregate({
        where: { eventId: event.id },
        _max: { sortOrder: true },
      });
      return transaction.participantPortal.create({
        data: { eventId: event.id, ...data, isDefault: makeDefault, sortOrder: (maximum._max.sortOrder ?? -1) + 1 },
      });
    });
    revalidatePath(portalPath(event.slug));
    revalidatePath(`/portal/${encodeURIComponent(event.slug)}`);
    return {
      status: "success",
      message: parsed.data.portalId ? "Portal updated." : "Portal created.",
      portalId: portal.id,
    };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return { status: "error", message: "That portal slug is already in use for this event." };
    }
    throw error;
  }
}

export async function moveParticipantPortal(
  eventSlug: string,
  portalId: string,
  direction: "up" | "down",
): Promise<PortalMutationState> {
  if (!z.uuid().safeParse(portalId).success) return { status: "error", message: "The selected portal is invalid." };
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const database = getDatabaseClient();
  const portals = await database.participantPortal.findMany({
    where: { eventId: event.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const index = portals.findIndex(({ id }) => id === portalId);
  const destination = index + (direction === "up" ? -1 : 1);
  if (index < 0 || destination < 0 || destination >= portals.length)
    return { status: "error", message: "That portal cannot move any farther." };
  const ids = portals.map(({ id }) => id);
  [ids[index], ids[destination]] = [ids[destination], ids[index]];
  await database.$transaction(
    ids.map((id, sortOrder) =>
      database.participantPortal.update({ where: { eventId_id: { eventId: event.id, id } }, data: { sortOrder } }),
    ),
  );
  revalidatePath(portalPath(event.slug));
  return { status: "success", message: "Audience precedence updated." };
}

export async function deleteParticipantPortal(eventSlug: string, portalId: string): Promise<PortalMutationState> {
  if (!z.uuid().safeParse(portalId).success) return { status: "error", message: "The selected portal is invalid." };
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const database = getDatabaseClient();
  await database.$transaction(async (transaction) => {
    const portal = await transaction.participantPortal.findUnique({
      where: { eventId_id: { eventId: event.id, id: portalId } },
      select: { isDefault: true },
    });
    if (!portal) return;
    await transaction.participantPortal.delete({ where: { eventId_id: { eventId: event.id, id: portalId } } });
    if (portal.isDefault) {
      const next = await transaction.participantPortal.findFirst({
        where: { eventId: event.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      if (next)
        await transaction.participantPortal.update({
          where: { eventId_id: { eventId: event.id, id: next.id } },
          data: { isDefault: true },
        });
    }
  });
  revalidatePath(portalPath(event.slug));
  revalidatePath(`/portal/${encodeURIComponent(event.slug)}`);
  return { status: "success", message: "Portal deleted." };
}
