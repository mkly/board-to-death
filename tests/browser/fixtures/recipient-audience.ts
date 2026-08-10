import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { provisionMagicLinkUser } from "../../../src/server/auth/magic-link-user.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test"))
  throw new Error("The recipient audience browser fixture requires a guarded *_test database.");

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
    name: "Program Summit",
    slug: "program-summit",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
  },
});
await database.communicationTemplate.create({
  data: {
    eventId: event.id,
    key: "speaker-update",
    name: "Speaker update",
    versions: {
      create: {
        version: 1,
        subjectTemplate: "Hello {{ recipient.name }}",
        htmlTemplate: "The latest update for {{ event.name }} is ready.",
        textTemplate: "Hello {{ recipient.name }} at {{ recipient.email }}.",
      },
    },
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
const category = await database.cfpCategory.create({
  data: { eventId: event.id, key: "design", label: "Game design" },
});

const speakers: { id: string }[] = [];
for (const [index, profile] of [
  { email: "ada@example.test", givenName: "Ada", familyName: "Lovelace", consent: true },
  { email: "grace@example.test", givenName: "Grace", familyName: "Hopper", consent: true },
  { email: "lin@example.test", givenName: "Lin", familyName: "Speaker", consent: false },
].entries()) {
  const speaker = await database.speaker.create({
    data: {
      eventId: event.id,
      normalizedEmail: profile.email,
      profileVersions: {
        create: {
          versionNumber: 1,
          email: profile.email,
          givenName: profile.givenName,
          familyName: profile.familyName,
          consentToReceiveEmail: profile.consent,
          consentedAt: profile.consent ? new Date("2027-01-01T00:00:00.000Z") : null,
        },
      },
    },
  });
  speakers.push(speaker);
  await database.cfpSubmission.create({
    data: {
      eventId: event.id,
      formVersionId: formVersion.id,
      kind: "ABSTRACT",
      status: "ACCEPTED",
      submittedAt: new Date("2027-01-10T18:00:00.000Z"),
      reviewStartedAt: new Date("2027-01-20T18:00:00.000Z"),
      decidedAt: new Date("2027-02-01T18:00:00.000Z"),
      participants: { create: { speakerId: speaker.id, sortOrder: index } },
      categories: { create: { categoryId: category.id, sortOrder: 0 } },
    },
  });
}

const session = await database.programSession.create({
  data: {
    eventId: event.id,
    kind: "MANUAL",
    versions: {
      create: {
        versionNumber: 1,
        title: "Opening keynote",
        durationMinutes: 45,
        participants: {
          create: speakers.slice(0, 2).map((speaker, sortOrder) => ({ speakerId: speaker.id, sortOrder })),
        },
      },
    },
  },
});
if (!session) throw new Error("Expected a program session.");

const definition = await database.speakerTaskDefinition.create({
  data: {
    eventId: event.id,
    key: "profile-review",
    versions: { create: { versionNumber: 1, sortOrder: 0, title: "Review profile", applicability: {} } },
  },
  include: { versions: true },
});
const definitionVersion = definition.versions[0];
const grace = speakers[1];
if (!definitionVersion || !grace) throw new Error("Expected onboarding fixtures.");
await database.speakerTaskAssignment.create({
  data: {
    eventId: event.id,
    definitionId: definition.id,
    definitionVersionId: definitionVersion.id,
    speakerId: grace.id,
    status: "APPROVED",
    submittedAt: new Date("2027-02-02T18:00:00.000Z"),
    completedAt: new Date("2027-02-03T18:00:00.000Z"),
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

process.stdout.write(JSON.stringify({ eventSlug: event.slug, sessionCookie }));
await database.$disconnect();
