import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test"))
  throw new Error("The onboarding browser fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";

await database.event.deleteMany();
await database.verification.deleteMany();
await database.account.deleteMany();
await database.session.deleteMany();
await database.user.deleteMany();

const event = await database.event.create({
  data: {
    name: "Future of Computing",
    slug: "future-of-computing",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
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

for (const [index, profile] of [
  { email: "ada@example.test", givenName: "Ada", familyName: "Lovelace" },
  { email: "grace@example.test", givenName: "Grace", familyName: "Hopper" },
].entries()) {
  const speaker = await database.speaker.create({
    data: {
      eventId: event.id,
      normalizedEmail: profile.email,
      profileVersions: { create: { versionNumber: 1, ...profile } },
    },
  });
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
    },
  });
}
await database.speakerTaskDefinition.create({
  data: {
    eventId: event.id,
    key: "biography",
    versions: {
      create: {
        versionNumber: 1,
        sortOrder: 0,
        title: "Review your biography",
        applicability: { confirmedOnly: false },
        defaultDueOffsetDays: 7,
      },
    },
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

process.stdout.write(JSON.stringify({ eventSlug: event.slug, sessionCookie }));
await database.$disconnect();
