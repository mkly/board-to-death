import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { provisionMagicLinkUser } from "../../../src/server/auth/magic-link-user.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) throw new Error("The admin intake fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";
const slug = "admin-intake-browser";
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
    name: "Admin Intake Browser Event",
    slug,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-09-12T16:00:00.000Z"),
    endsAt: new Date("2027-09-14T01:00:00.000Z"),
    tracks: { create: { name: "Main stage", color: "blue", sortOrder: 0 } },
    cfpForms: {
      create: {
        key: "main-cfp",
        versions: {
          create: {
            versionNumber: 1,
            schemaVersion: 1,
            title: "Browser Abstract Form",
            submissionKind: "ABSTRACT",
            accessPolicy: "OPEN",
            minimumSpeakerCount: 1,
            maximumSpeakerCount: 3,
            requiredSpeakerFields: [],
            customTypes: [],
            steps: {
              create: {
                key: "proposal",
                kind: "questions",
                title: "Proposal",
                sortOrder: 0,
                questions: {
                  create: [
                    { key: "title", type: "short_text", label: "Proposal title", required: true, sortOrder: 0 },
                    {
                      key: "format",
                      type: "select",
                      label: "Format",
                      required: true,
                      constraints: {
                        options: [
                          { label: "Talk", value: "talk" },
                          { label: "Workshop", value: "workshop" },
                        ],
                      },
                      sortOrder: 1,
                    },
                    {
                      key: "summary",
                      type: "long_text",
                      label: "Summary",
                      required: true,
                      visibleWhen: {
                        logic: "all",
                        conditions: [{ questionId: "format", operator: "equals", value: "workshop" }],
                      },
                      sortOrder: 2,
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    speakers: {
      create: {
        normalizedEmail: "alex@example.test",
        profileVersions: {
          create: {
            versionNumber: 1,
            email: "alex@example.test",
            givenName: "Alex",
            familyName: "Rivera",
          },
        },
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
await provisionMagicLinkUser(database, { email: adminEmail });
await browserAuth.handler(
  new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ email: adminEmail, callbackURL: "/dashboard" }),
  }),
);
if (deliveredLink === "") throw new Error("Expected the browser administrator magic link to be delivered.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");
await grantSeededOrganizationAccess(adminEmail);

process.stdout.write(
  JSON.stringify({ eventId: event.id, eventSlug: event.slug, speakerEmail: "alex@example.test", sessionCookie }),
);
await database.$disconnect();
