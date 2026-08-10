import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test"))
  throw new Error("The contact custom-field fixture requires a guarded *_test database.");

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
    name: "Contact Fields Summit",
    slug: "contact-fields-summit",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
    sponsorsEnabled: true,
    exhibitorsEnabled: true,
  },
});
const otherEvent = await database.event.create({
  data: {
    name: "Private Contact Event",
    slug: "private-contact-event",
    timezone: "America/New_York",
    startsAt: new Date("2027-06-10T16:00:00.000Z"),
    endsAt: new Date("2027-06-12T00:00:00.000Z"),
    sponsorsEnabled: true,
  },
});
const contact = await database.contact.create({
  data: {
    eventId: event.id,
    email: "dana@example.test",
    givenName: "Dana",
    familyName: "Reed",
    organization: "Reed Robotics",
  },
});
const group = await database.contactGroup.create({
  data: { eventId: event.id, slug: "tabletop-partners", name: "Tabletop Partners", kind: "SPONSOR" },
});
const privateContact = await database.contact.create({
  data: {
    eventId: otherEvent.id,
    email: "private@example.test",
    givenName: "Private",
    familyName: "Person",
  },
});
const contactField = await database.customFieldDefinition.create({
  data: {
    eventId: event.id,
    entityType: "CONTACT",
    key: "dietary_notes",
    label: "Dietary notes",
    type: "SINGLE_LINE_TEXT",
    position: 0,
  },
});
const groupField = await database.customFieldDefinition.create({
  data: {
    eventId: event.id,
    entityType: "CONTACT_GROUP",
    key: "booth_location",
    label: "Booth location",
    type: "SINGLE_LINE_TEXT",
    position: 0,
  },
});
const privateField = await database.customFieldDefinition.create({
  data: {
    eventId: otherEvent.id,
    entityType: "CONTACT",
    key: "private_notes",
    label: "Private notes",
    type: "SINGLE_LINE_TEXT",
    position: 0,
  },
});
await database.customFieldValue.createMany({
  data: [
    {
      eventId: event.id,
      definitionId: contactField.id,
      contactId: contact.id,
      value: "Vegan",
      normalizedText: "vegan",
    },
    {
      eventId: event.id,
      definitionId: groupField.id,
      groupId: group.id,
      value: "Hall A",
      normalizedText: "hall a",
    },
    {
      eventId: otherEvent.id,
      definitionId: privateField.id,
      contactId: privateContact.id,
      value: "Never render this",
      normalizedText: "never render this",
    },
  ],
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
if (!deliveredLink) throw new Error("Expected the contact custom-field fixture to receive a magic link.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");

if (event.orgId !== otherEvent.orgId)
  throw new Error("The contact custom-field fixture expects both events in one organization.");
const adminUser = await database.user.findFirst({ where: { email: adminEmail }, select: { id: true } });
if (!adminUser) throw new Error("Expected the contact custom-field fixture to create an admin user.");
await database.organizationMember.upsert({
  where: { orgId_userId: { orgId: event.orgId, userId: adminUser.id } },
  update: { role: "OWNER", status: "ACTIVE", revokedAt: null },
  create: { orgId: event.orgId, userId: adminUser.id, role: "OWNER", status: "ACTIVE" },
});

process.stdout.write(
  JSON.stringify({
    eventId: event.id,
    eventSlug: event.slug,
    otherEventId: otherEvent.id,
    otherEventSlug: otherEvent.slug,
    sessionCookie,
  }),
);
await database.$disconnect();
