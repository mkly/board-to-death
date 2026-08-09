import { PrismaPg } from "@prisma/adapter-pg";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins";

import { CfpAdminRole, CfpDraftPolicy, EventType, PrismaClient } from "../../../src/generated/prisma/client.ts";
import type { CfpQuestion } from "../../../src/lib/cfp/types.ts";
import { CfpAdministratorRepository, CfpPolicyRepository } from "../../../src/server/cfp/policies.ts";
import { CfpFormRepository } from "../../../src/server/cfp/repositories.ts";
import { CfpCategoryRepository } from "../../../src/server/cfp/submissions.ts";
import { EventRepository } from "../../../src/server/events/repositories.ts";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl?.includes("_test")) throw new Error("CFP browser fixtures require a guarded *_test database.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const mode = process.argv[2];
const baseURL = process.argv[3] ?? "http://127.0.0.1:3100";
const adminEmail = "admin@example.test";

interface FixtureOptions {
  readonly questions?: readonly CfpQuestion[];
  readonly categories?: ReadonlyArray<{ key: string; label: string }>;
}

async function createEventFormAndPolicy(options: FixtureOptions = {}) {
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
      sections: [{ id: "proposal", kind: "questions", title: "Proposal", questions: [...(options.questions ?? [])] }],
    },
  });
  const administrators = new CfpAdministratorRepository(client);
  const owner = await administrators.create({
    eventId: event.id,
    externalId: adminEmail,
    displayName: "CFP Owner",
  });
  const editor = await administrators.create({
    eventId: event.id,
    externalId: "editor@example.test",
    displayName: "Program Editor",
  });
  const categoryRepository = new CfpCategoryRepository(client);
  const categories = [];
  for (const category of options.categories ?? []) {
    categories.push(
      await categoryRepository.create({ eventId: event.id, key: category.key, label: category.label }),
    );
  }
  await new CfpPolicyRepository(client).create({
    eventId: event.id,
    key: form.key,
    definition: {
      submissionOpensAt: new Date("2027-09-01T16:00:00.000Z"),
      submissionClosesAt: new Date("2028-02-01T08:00:00.000Z"),
      confirmationClosesAt: new Date("2028-03-01T08:00:00.000Z"),
      draftPolicy: CfpDraftPolicy.ALLOWED,
      submissionLimits: { maxSubmissionsPerSpeaker: 2, maxParticipantsPerSubmission: 4 },
      messages: {
        introduction: "Share your tabletop proposal.",
        submissionConfirmation: "Your proposal was received.",
        closed: "This CFP is closed.",
      },
      conditionalVisibility: [],
      categoryRouting: [],
      adminAssignments: [
        {
          administratorId: owner.id,
          role: CfpAdminRole.OWNER,
          notifyOnNewSubmission: false,
          notifyOnSubmissionUpdate: false,
        },
      ],
    },
  });

  return { eventSlug, event, form, owner, editor, categories };
}

async function signIn(): Promise<string> {
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
        sendMagicLink: async ({ email, url }: { email: string; url: string }) => {
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
  return sessionToken;
}

async function setup() {
  const { eventSlug, event, form, editor } = await createEventFormAndPolicy();
  const sessionToken = await signIn();
  console.log(JSON.stringify({ editorId: editor.id, eventId: event.id, eventSlug, formId: form.formId, sessionToken }));
}

async function categoryRouting() {
  const { eventSlug, event, form, editor, categories } = await createEventFormAndPolicy({
    questions: [
      {
        id: "topic",
        type: "select",
        label: "Topic",
        required: true,
        constraints: {
          options: [
            { value: "game-design", label: "Game design" },
            { value: "publishing", label: "Publishing" },
          ],
        },
      },
    ],
    categories: [
      { key: "game-design", label: "Game Design" },
      { key: "publishing", label: "Publishing" },
    ],
  });
  const sessionToken = await signIn();
  console.log(
    JSON.stringify({
      editorId: editor.id,
      eventId: event.id,
      eventSlug,
      formId: form.formId,
      sessionToken,
      categories: categories.map(({ id, key, label }) => ({ id, key, label })),
    }),
  );
}

async function cleanup(eventSlug: string | undefined) {
  if (eventSlug) await client.event.deleteMany({ where: { slug: eventSlug } });
  await client.session.deleteMany({ where: { user: { email: adminEmail } } });
  await client.user.deleteMany({ where: { email: adminEmail } });
}

async function publication(eventSlug: string | undefined) {
  if (!eventSlug) throw new Error("Publication lookup requires an event slug.");
  const policy = await client.cfpPolicy.findFirstOrThrow({
    where: { event: { slug: eventSlug }, key: "main-cfp" },
    select: {
      publicId: true,
      status: true,
      publishedFormVersion: { select: { title: true, versionNumber: true } },
    },
  });
  console.log(JSON.stringify(policy));
}

try {
  await client.$connect();
  if (mode === "setup") {
    await setup();
  } else if (mode === "categoryRouting") {
    await categoryRouting();
  } else if (mode === "cleanup") {
    await cleanup(process.argv[3]);
  } else if (mode === "publication") {
    await publication(process.argv[3]);
  } else {
    throw new Error(`Unknown CFP browser fixture mode: ${mode ?? "(missing)"}`);
  }
} finally {
  await client.$disconnect();
}
