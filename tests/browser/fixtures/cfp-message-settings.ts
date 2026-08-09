import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { writeFile } from "node:fs/promises";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test"))
  throw new Error("The CFP message browser fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";

await database.event.deleteMany();
await database.verification.deleteMany();
await database.account.deleteMany();
await database.session.deleteMany();
await database.user.deleteMany();

const event = await database.event.create({
  data: {
    name: "Board to Death 2027",
    slug: "board-to-death-2027",
    location: "Portland, Oregon",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-09-12T16:00:00.000Z"),
    endsAt: new Date("2027-09-14T01:00:00.000Z"),
  },
});
const form = await database.cfpForm.create({
  data: {
    eventId: event.id,
    key: "main-cfp",
    versions: {
      create: {
        versionNumber: 1,
        schemaVersion: 1,
        title: "Board Game Design CFP",
        description: "Share a proposal with the program committee.",
        customTypes: [],
        steps: { create: { key: "proposal", kind: "questions", title: "Proposal", sortOrder: 0 } },
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
if (deliveredLink === "") throw new Error("Expected the browser administrator magic link to be delivered.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");

const fixture = { eventId: event.id, eventSlug: event.slug, formId: form.id, sessionCookie };
const browserStatePath = process.env.BROWSER_STATE_PATH;
if (browserStatePath) {
  const domain = new URL(baseURL).hostname;
  await writeFile(
    browserStatePath,
    JSON.stringify({
      cookies: [
        {
          name: "better-auth.session_token",
          value: sessionCookie,
          domain,
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
        {
          name: "board_to_death_active_event",
          value: event.id,
          domain,
          path: "/dashboard",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    { mode: 0o600 },
  );
  process.stdout.write(JSON.stringify({ eventId: event.id, eventSlug: event.slug, formId: form.id }));
} else {
  process.stdout.write(JSON.stringify(fixture));
}
await database.$disconnect();
