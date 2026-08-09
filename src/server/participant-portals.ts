import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";

export const PORTAL_ACCENT_COLORS = [
  "neutral",
  "rose",
  "orange",
  "amber",
  "emerald",
  "sky",
  "indigo",
  "violet",
] as const;
export const PORTAL_PARTICIPANT_ROLES = ["SPEAKER", "MODERATOR", "CHAIRPERSON"] as const;
export const PORTAL_SUBMISSION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "WAITLISTED",
  "ACCEPTED",
  "REJECTED",
  "CONFIRMED",
] as const;
export const PORTAL_GROUP_KINDS = ["SPONSOR", "EXHIBITOR"] as const;
export const PORTAL_CONTENT_KEYS = [
  "submissions",
  "profile",
  "tasks",
  "sessions",
  "resources",
  "files",
  "forms",
] as const;
export const PORTAL_PROFILE_FIELDS = [
  "phone",
  "pronouns",
  "organization",
  "jobTitle",
  "biography",
  "websiteUrl",
  "accessibilityNeeds",
] as const;

export type PortalContentKey = (typeof PORTAL_CONTENT_KEYS)[number];
export type PortalProfileField = (typeof PORTAL_PROFILE_FIELDS)[number];
export type PortalFieldMode = "editable" | "view" | "hidden";

const audienceSchema = z.object({
  roles: z.array(z.enum(PORTAL_PARTICIPANT_ROLES)).default([]),
  submissionStatuses: z.array(z.enum(PORTAL_SUBMISSION_STATUSES)).default([]),
  groupKinds: z.array(z.enum(PORTAL_GROUP_KINDS)).default([]),
});
const contentSchema = z.object(
  Object.fromEntries(PORTAL_CONTENT_KEYS.map((key) => [key, z.boolean().default(true)])) as Record<
    PortalContentKey,
    z.ZodDefault<z.ZodBoolean>
  >,
);
const fieldSchema = z.object(
  Object.fromEntries(
    PORTAL_PROFILE_FIELDS.map((key) => [key, z.enum(["editable", "view", "hidden"]).default("editable")]),
  ) as Record<PortalProfileField, z.ZodDefault<z.ZodEnum<{ editable: "editable"; view: "view"; hidden: "hidden" }>>>,
);
const titleSchema = z.object({
  submissions: z.string().default("My submissions"),
  profile: z.string().default("My profile"),
  tasks: z.string().default("Onboarding tasks"),
  sessions: z.string().default("My sessions"),
  resources: z.string().default("Resources"),
});

export interface ParticipantPortalConfig {
  readonly id: string | null;
  readonly name: string;
  readonly slug: string;
  readonly welcomeMessage: string;
  readonly accentColor: (typeof PORTAL_ACCENT_COLORS)[number];
  readonly logoObjectKey: string;
  readonly backgroundObjectKey: string;
  readonly sectionTitles: z.infer<typeof titleSchema>;
  readonly audienceRules: z.infer<typeof audienceSchema>;
  readonly contentVisibility: z.infer<typeof contentSchema>;
  readonly profileFieldVisibility: z.infer<typeof fieldSchema>;
  readonly isDefault: boolean;
  readonly sortOrder: number;
}

export const DEFAULT_PARTICIPANT_PORTAL: ParticipantPortalConfig = {
  id: null,
  name: "Speaker portal",
  slug: "speaker",
  welcomeMessage: "Track your proposals, speaking schedule, onboarding work, and event resources in one place.",
  accentColor: "neutral",
  logoObjectKey: "",
  backgroundObjectKey: "",
  sectionTitles: titleSchema.parse({}),
  audienceRules: audienceSchema.parse({}),
  contentVisibility: contentSchema.parse({}),
  profileFieldVisibility: fieldSchema.parse({}),
  isDefault: true,
  sortOrder: 0,
};

function parsePortal(portal: {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly welcomeMessage: string | null;
  readonly accentColor: string;
  readonly logoObjectKey: string | null;
  readonly backgroundObjectKey: string | null;
  readonly sectionTitles: unknown;
  readonly audienceRules: unknown;
  readonly contentVisibility: unknown;
  readonly profileFieldVisibility: unknown;
  readonly isDefault: boolean;
  readonly sortOrder: number;
}): ParticipantPortalConfig {
  return {
    ...portal,
    welcomeMessage: portal.welcomeMessage ?? "",
    accentColor: z.enum(PORTAL_ACCENT_COLORS).catch("neutral").parse(portal.accentColor),
    logoObjectKey: portal.logoObjectKey ?? "",
    backgroundObjectKey: portal.backgroundObjectKey ?? "",
    sectionTitles: titleSchema.catch(DEFAULT_PARTICIPANT_PORTAL.sectionTitles).parse(portal.sectionTitles),
    audienceRules: audienceSchema.catch(DEFAULT_PARTICIPANT_PORTAL.audienceRules).parse(portal.audienceRules),
    contentVisibility: contentSchema
      .catch(DEFAULT_PARTICIPANT_PORTAL.contentVisibility)
      .parse(portal.contentVisibility),
    profileFieldVisibility: fieldSchema
      .catch(DEFAULT_PARTICIPANT_PORTAL.profileFieldVisibility)
      .parse(portal.profileFieldVisibility),
  };
}

export async function listParticipantPortals(
  database: PrismaClient,
  eventId: string,
): Promise<ParticipantPortalConfig[]> {
  const portals = await database.participantPortal.findMany({
    where: { eventId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return portals.map(parsePortal);
}

interface ParticipantTraits {
  readonly roles: ReadonlySet<string>;
  readonly submissionStatuses: ReadonlySet<string>;
  readonly groupKinds: ReadonlySet<string>;
}

export function portalMatchesParticipant(portal: ParticipantPortalConfig, traits: ParticipantTraits): boolean {
  const { roles, submissionStatuses, groupKinds } = portal.audienceRules;
  return (
    (roles.length === 0 || roles.some((role) => traits.roles.has(role))) &&
    (submissionStatuses.length === 0 || submissionStatuses.some((status) => traits.submissionStatuses.has(status))) &&
    (groupKinds.length === 0 || groupKinds.some((kind) => traits.groupKinds.has(kind)))
  );
}

export async function resolveParticipantPortal(
  database: PrismaClient,
  identity: { readonly eventId: string; readonly speakerId: string },
): Promise<ParticipantPortalConfig> {
  const [portals, speaker] = await Promise.all([
    listParticipantPortals(database, identity.eventId),
    database.speaker.findFirst({
      where: { eventId: identity.eventId, id: identity.speakerId },
      select: {
        profileVersions: { orderBy: { versionNumber: "desc" }, take: 1, select: { email: true } },
        programSessionParticipants: { select: { role: true } },
        submissions: { select: { submission: { select: { status: true } } } },
      },
    }),
  ]);
  if (!speaker || portals.length === 0) return DEFAULT_PARTICIPANT_PORTAL;

  const email = speaker.profileVersions[0]?.email;
  const groupMemberships = email
    ? await database.contactGroupMember.findMany({
        where: { eventId: identity.eventId, contact: { email: { equals: email, mode: "insensitive" } } },
        select: { group: { select: { kind: true } } },
      })
    : [];
  const traits: ParticipantTraits = {
    roles: new Set(speaker.programSessionParticipants.map(({ role }) => role)),
    submissionStatuses: new Set(speaker.submissions.map(({ submission }) => submission.status)),
    groupKinds: new Set(groupMemberships.map(({ group }) => group.kind)),
  };
  return (
    portals.find((portal) => !portal.isDefault && portalMatchesParticipant(portal, traits)) ??
    portals.find((portal) => portal.isDefault) ??
    DEFAULT_PARTICIPANT_PORTAL
  );
}
