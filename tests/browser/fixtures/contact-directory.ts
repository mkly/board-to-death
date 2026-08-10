import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { provisionMagicLinkUser } from "../../../src/server/auth/magic-link-user.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test"))
  throw new Error("The contact directory fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";

await database.integrationSyncRecord.deleteMany();
await database.event.deleteMany();
await database.person.deleteMany();
await database.verification.deleteMany();
await database.account.deleteMany();
await database.session.deleteMany();
await database.user.deleteMany();

const firstEvent = await database.event.create({
  data: {
    name: "Directory Origins",
    slug: "directory-origins",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
  },
});
const activeEvent = await database.event.create({
  data: {
    name: "Directory Return",
    slug: "directory-return",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2028-05-10T16:00:00.000Z"),
    endsAt: new Date("2028-05-12T00:00:00.000Z"),
  },
});
const person = await database.person.create({
  data: {
    email: "dana@example.test",
    givenName: "Dana",
    familyName: "Reed",
    organization: "Reed Robotics",
    jobTitle: "Founder",
  },
});
await database.person.create({
  data: {
    email: "dana.alt@example.test",
    givenName: "Dana",
    familyName: "Reed",
    organization: "Alternate Robotics",
    jobTitle: "Advisor",
  },
});
await database.contact.create({
  data: {
    eventId: firstEvent.id,
    personId: person.id,
    email: person.email,
    givenName: person.givenName,
    familyName: person.familyName,
    organization: person.organization,
    jobTitle: person.jobTitle,
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
if (deliveredLink === "") throw new Error("Expected the contact directory fixture to receive a magic link.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");
await grantSeededOrganizationAccess(adminEmail);

process.stdout.write(
  JSON.stringify({ activeEventId: activeEvent.id, eventSlug: activeEvent.slug, personId: person.id, sessionCookie }),
);
await database.$disconnect();
