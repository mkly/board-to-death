import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { provisionMagicLinkUser } from "../../../src/server/auth/magic-link-user.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) throw new Error("The groups fixture requires a guarded *_test database.");
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
    name: "Partner Summit",
    slug: "partner-summit",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
    sponsorsEnabled: true,
    exhibitorsEnabled: true,
  },
});
const [ada] = await Promise.all([
  database.contact.create({
    data: { eventId: event.id, email: "ada@example.test", givenName: "Ada", familyName: "Lovelace" },
  }),
  database.contact.create({
    data: { eventId: event.id, email: "grace@example.test", givenName: "Grace", familyName: "Hopper" },
  }),
]);
const [gold, silver] = await Promise.all([
  database.contactGroupTier.create({ data: { eventId: event.id, kind: "SPONSOR", name: "Gold", sortOrder: 0 } }),
  database.contactGroupTier.create({ data: { eventId: event.id, kind: "SPONSOR", name: "Silver", sortOrder: 1 } }),
]);
await Promise.all([
  database.contactGroup.create({
    data: {
      eventId: event.id,
      kind: "SPONSOR",
      name: "Analytical Engines",
      slug: "analytical-engines",
      tierId: gold.id,
      primaryContactId: ada.id,
    },
  }),
  database.contactGroup.create({
    data: {
      eventId: event.id,
      kind: "SPONSOR",
      name: "Compiler Collective",
      slug: "compiler-collective",
      tierId: silver.id,
    },
  }),
]);

const other = await database.event.create({
  data: {
    name: "Other Summit",
    slug: "other-partner-summit",
    timezone: "UTC",
    startsAt: new Date("2027-07-10T16:00:00.000Z"),
    endsAt: new Date("2027-07-12T00:00:00.000Z"),
    sponsorsEnabled: true,
  },
});
const analyticalEngines = await database.contactGroup.findUniqueOrThrow({
  where: { eventId_slug: { eventId: event.id, slug: "analytical-engines" } },
});
await database.contactGroupMember.create({
  data: { eventId: event.id, groupId: analyticalEngines.id, contactId: ada.id },
});
const foreignContact = await database.contact.create({
  data: { eventId: other.id, email: "foreign@example.test", givenName: "Foreign", familyName: "Contact" },
});
const foreignTier = await database.contactGroupTier.create({
  data: { eventId: other.id, kind: "SPONSOR", name: "Foreign", sortOrder: 0 },
});
await database.contactGroup.create({
  data: {
    eventId: other.id,
    kind: "SPONSOR",
    name: "Foreign Group",
    slug: "foreign-group",
    tierId: foreignTier.id,
    primaryContactId: foreignContact.id,
  },
});
const foreignGroup = await database.contactGroup.findUniqueOrThrow({
  where: { eventId_slug: { eventId: other.id, slug: "foreign-group" } },
});
await database.contactGroupMember.create({
  data: { eventId: other.id, groupId: foreignGroup.id, contactId: foreignContact.id },
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
if (deliveredLink === "") throw new Error("Expected the groups fixture to receive a magic link.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");
await grantSeededOrganizationAccess(adminEmail);

process.stdout.write(JSON.stringify({ eventSlug: event.slug, sessionCookie }));
await database.$disconnect();
