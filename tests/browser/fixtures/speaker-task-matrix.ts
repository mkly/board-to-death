import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { provisionMagicLinkUser } from "../../../src/server/auth/magic-link-user.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test"))
  throw new Error("The speaker task matrix fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";

await database.integrationSyncRecord.deleteMany();
await database.event.deleteMany();
await database.verification.deleteMany();
await database.account.deleteMany();
await database.session.deleteMany();
await database.user.deleteMany();

const event = await database.event.create({
  data: {
    name: "Speaker Matrix Summit",
    slug: "speaker-matrix-summit",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
  },
});
const otherEvent = await database.event.create({
  data: {
    name: "Private Other Event",
    slug: "private-other-event",
    timezone: "America/New_York",
    startsAt: new Date("2027-06-10T16:00:00.000Z"),
    endsAt: new Date("2027-06-12T00:00:00.000Z"),
  },
});
const form = await database.cfpForm.create({
  data: {
    eventId: event.id,
    key: "main",
    versions: { create: { versionNumber: 1, schemaVersion: 1, title: "Main CFP", customTypes: {} } },
  },
  include: { versions: true },
});
const formVersion = form.versions[0];
if (!formVersion) throw new Error("Expected a CFP form version.");

async function createSpeaker(email: string, givenName: string, familyName: string, status: "ACCEPTED" | "CONFIRMED") {
  const speaker = await database.speaker.create({
    data: {
      eventId: event.id,
      normalizedEmail: email,
      profileVersions: { create: { versionNumber: 1, email, givenName, familyName } },
    },
  });
  await database.cfpSubmission.create({
    data: {
      eventId: event.id,
      formVersionId: formVersion.id,
      kind: "ABSTRACT",
      status,
      submittedAt: new Date("2027-01-10T18:00:00.000Z"),
      reviewStartedAt: new Date("2027-01-20T18:00:00.000Z"),
      decidedAt: new Date("2027-02-01T18:00:00.000Z"),
      confirmedAt: status === "CONFIRMED" ? new Date("2027-02-02T18:00:00.000Z") : null,
      participants: { create: { speakerId: speaker.id, sortOrder: 0 } },
    },
  });
  return speaker;
}

const ada = await createSpeaker("ada@example.test", "Ada", "Lovelace", "CONFIRMED");
const grace = await createSpeaker("grace@example.test", "Grace", "Hopper", "ACCEPTED");
const biography = await database.speakerTaskDefinition.create({
  data: {
    eventId: event.id,
    key: "biography",
    versions: {
      create: { versionNumber: 1, sortOrder: 0, title: "Review biography", applicability: {} },
    },
  },
  include: { versions: true },
});
const agreement = await database.speakerTaskDefinition.create({
  data: {
    eventId: event.id,
    key: "agreement",
    versions: {
      create: {
        versionNumber: 1,
        sortOrder: 1,
        title: "Sign agreement",
        applicability: { confirmedOnly: true },
      },
    },
  },
});
const biographyVersion = biography.versions[0];
if (!biographyVersion) throw new Error("Expected a biography task version.");
await database.speakerTaskAssignment.createMany({
  data: [
    {
      eventId: event.id,
      definitionId: biography.id,
      definitionVersionId: biographyVersion.id,
      speakerId: ada.id,
      status: "SUBMITTED",
      assignedAt: new Date("2026-01-01T08:00:00.000Z"),
      dueAt: new Date("2026-01-03T07:59:59.000Z"),
      submittedAt: new Date("2026-01-02T18:00:00.000Z"),
    },
    {
      eventId: event.id,
      definitionId: biography.id,
      definitionVersionId: biographyVersion.id,
      speakerId: grace.id,
      status: "APPROVED",
      assignedAt: new Date("2026-01-01T08:00:00.000Z"),
      dueAt: new Date("2026-01-03T07:59:59.000Z"),
      submittedAt: new Date("2026-01-02T18:00:00.000Z"),
      completedAt: new Date("2026-01-02T19:00:00.000Z"),
    },
  ],
});
await database.speakerTaskDefinition.create({
  data: {
    eventId: otherEvent.id,
    key: "secret-task",
    versions: { create: { versionNumber: 1, sortOrder: 0, title: "Other event secret", applicability: {} } },
  },
});

let deliveredLink = "";
const browserAuth = createAuth({
  baseURL,
  database,
  isAllowedEmail: (email) => email === adminEmail,
  secret: "quality-gate-better-auth-secret-at-least-32-characters",
  sendMagicLink: async ({ url }) => {
    deliveredLink = url;
  },
});
await provisionMagicLinkUser(database, { email: adminEmail });
await browserAuth.handler(
  new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ email: adminEmail, callbackURL: "/dashboard" }),
  }),
);
if (deliveredLink === "") throw new Error("Expected the browser fixture to receive a magic link.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");
await grantSeededOrganizationAccess(adminEmail);

process.stdout.write(
  JSON.stringify({
    eventSlug: event.slug,
    sessionCookie,
    biographyTaskId: biography.id,
    agreementTaskId: agreement.id,
  }),
);
await database.$disconnect();
