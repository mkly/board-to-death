import { PrismaPg } from "@prisma/adapter-pg";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins";

import { EventType, PrismaClient } from "../../../src/generated/prisma/client.ts";
import { CfpFormRepository } from "../../../src/server/cfp/repositories.ts";
import { EventRepository } from "../../../src/server/events/repositories.ts";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl?.includes("_test")) throw new Error("CFP browser fixtures require a guarded *_test database.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const mode = process.argv[2];
const baseURL = process.argv[3] ?? "http://127.0.0.1:3100";
const adminEmail = "admin@example.test";

async function setup() {
  const eventSlug = `cfp-setup-${randomUUID()}`;
  const event = await new EventRepository(client).create({
    name: "Board to Death CFP Workshop",
    slug: eventSlug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2028-03-10T17:00:00.000Z"),
    endsAt: new Date("2028-03-12T01:00:00.000Z"),
  });
  const form = await new CfpFormRepository(client).create({
    eventId: event.id,
    key: "main-cfp",
    definition: {
      version: 1,
      title: "Untitled CFP",
      submissionKind: "ABSTRACT",
      accessPolicy: "OPEN",
      welcomeTitle: "Submit your session",
      welcomeContent: "Share your idea with our program team.",
      instructions: "Complete each required field before submitting your proposal.",
      termsContent: "",
      consentRequired: false,
      minimumSpeakerCount: 1,
      maximumSpeakerCount: 1,
      requiredSpeakerFields: [],
      sections: [{ id: "proposal", kind: "questions", title: "Proposal", questions: [] }],
    },
  });

  let magicLinkUrl = "";
  const auth = betterAuth({
    appName: "Board to Death",
    baseURL,
    database: prismaAdapter(client, { provider: "postgresql" }),
    secret: "quality-gate-better-auth-secret-at-least-32-characters",
    plugins: [
      magicLink({
        expiresIn: 600,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          if (email === adminEmail) magicLinkUrl = url;
        },
      }),
    ],
  });
  await auth.handler(
    new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: adminEmail, callbackURL: "/dashboard" }),
    }),
  );
  if (magicLinkUrl === "") throw new Error("Expected a browser-test magic link.");

  const verified = await auth.handler(new Request(magicLinkUrl, { redirect: "manual" }));
  const sessionToken = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
  if (!sessionToken) throw new Error("Expected Better Auth to create a browser-test session.");
  console.log(JSON.stringify({ eventId: event.id, eventSlug, formId: form.formId, sessionToken }));
}

async function cleanup(eventSlug: string | undefined) {
  if (eventSlug) await client.event.deleteMany({ where: { slug: eventSlug } });
  await client.session.deleteMany({ where: { user: { email: adminEmail } } });
  await client.user.deleteMany({ where: { email: adminEmail } });
}

try {
  await client.$connect();
  if (mode === "setup") {
    await setup();
  } else if (mode === "cleanup") {
    await cleanup(process.argv[3]);
  } else {
    throw new Error(`Unknown CFP browser fixture mode: ${mode ?? "(missing)"}`);
  }
} finally {
  await client.$disconnect();
}
