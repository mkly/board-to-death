import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test"))
  throw new Error("The spreadsheet import fixture requires a guarded *_test database.");
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";
const slug = "spreadsheet-import-browser";
const command = process.argv[2] ?? "seed";

if (command === "cleanup") {
  await database.event.deleteMany({ where: { slug } });
  await database.$disconnect();
  process.stdout.write(JSON.stringify({ cleaned: true }));
  process.exit(0);
}

await database.event.deleteMany({ where: { slug } });
const event = await database.event.create({
  data: {
    name: "Spreadsheet Import Browser Event",
    slug,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-09-12T16:00:00.000Z"),
    endsAt: new Date("2027-09-14T01:00:00.000Z"),
    customFieldDefinitions: {
      create: {
        entityType: "CONTACT",
        key: "meal",
        label: "Meal preference",
        type: "SINGLE_SELECT",
        options: ["Vegan", "Standard"],
        position: 0,
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
if (!deliveredLink) throw new Error("Expected the browser administrator magic link to be delivered.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");
await grantSeededOrganizationAccess(adminEmail);
const adminUser = await database.user.findFirst({ where: { email: adminEmail }, select: { id: true } });
if (!adminUser) throw new Error("Expected the spreadsheet import fixture to create an admin user.");
await database.organizationMember.upsert({
  where: { orgId_userId: { orgId: event.orgId, userId: adminUser.id } },
  update: { role: "OWNER", status: "ACTIVE", revokedAt: null },
  create: { orgId: event.orgId, userId: adminUser.id, role: "OWNER", status: "ACTIVE" },
});

process.stdout.write(JSON.stringify({ eventId: event.id, eventSlug: event.slug, sessionCookie }));
await database.$disconnect();
