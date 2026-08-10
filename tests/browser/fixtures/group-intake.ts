import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { provisionMagicLinkUser } from "../../../src/server/auth/magic-link-user.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) throw new Error("The group intake fixture requires a guarded *_test database.");
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
    name: "Partner Intake Summit",
    slug: "partner-intake-summit",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
    sponsorsEnabled: true,
    exhibitorsEnabled: true,
  },
});
const other = await database.event.create({
  data: {
    name: "Other Partner Summit",
    slug: "other-partner-intake-summit",
    timezone: "UTC",
    startsAt: new Date("2027-07-10T16:00:00.000Z"),
    endsAt: new Date("2027-07-12T00:00:00.000Z"),
    sponsorsEnabled: true,
  },
});
const foreignForm = await database.contactGroupIntakeForm.create({
  data: {
    eventId: other.id,
    kind: "SPONSOR",
    title: "Foreign sponsor interest",
    status: "PUBLISHED",
    publishedAt: new Date(),
  },
});
await database.contactGroupIntakeSubmission.create({
  data: {
    eventId: other.id,
    formId: foreignForm.id,
    organizationName: "Foreign Organization",
    organizationSlug: "foreign-organization",
    contactGivenName: "Foreign",
    contactFamilyName: "Contact",
    contactEmail: "foreign@example.test",
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
if (deliveredLink === "") throw new Error("Expected the group intake fixture to receive a magic link.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");
await grantSeededOrganizationAccess(adminEmail);

process.stdout.write(
  JSON.stringify({ eventId: event.id, eventSlug: event.slug, publicFormId: foreignForm.publicId, sessionCookie }),
);
await database.$disconnect();
