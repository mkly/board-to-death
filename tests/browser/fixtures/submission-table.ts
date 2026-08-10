import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  EventType,
  type Prisma,
  PrismaClient,
} from "../../../src/generated/prisma/client.ts";
import type { CfpFormDefinition } from "../../../src/lib/cfp/index.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { CfpFormRepository } from "../../../src/server/cfp/repositories.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const adminEmail = "admin@example.test";
const authSecret = "quality-gate-better-auth-secret-at-least-32-characters";
const eventSlugs = {
  empty: "browser-empty-submissions",
  large: "browser-large-submissions",
  other: "browser-other-submissions",
} as const;
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const forms = new CfpFormRepository(database);

interface SeededEvent {
  readonly id: string;
  readonly slug: string;
  readonly designCategoryId: string;
  readonly formVersionId: string;
}

const definition: CfpFormDefinition = {
  version: 1,
  title: "Board Game Design CFP",
  sections: [
    {
      id: "proposal",
      kind: "questions",
      title: "Proposal",
      questions: [{ id: "audience", type: "short_text", label: "Audience", required: true }],
    },
  ],
};

function ensureTestDatabase() {
  if (!new URL(databaseUrl).pathname.replace(/^\//, "").endsWith("_test")) {
    throw new Error("Browser submission fixtures require a guarded *_test database.");
  }
}

async function createEvent(slug: string, startsAt: string): Promise<SeededEvent> {
  const event = await database.event.create({
    data: {
      name: slug === eventSlugs.empty ? "Empty Submission Event" : "Board to Death Browser Event",
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date(startsAt),
      endsAt: new Date(new Date(startsAt).getTime() + 2 * 24 * 60 * 60 * 1000),
    },
  });
  const form = await forms.create({ eventId: event.id, key: "main-cfp", definition });
  const version = await database.cfpFormVersion.findUniqueOrThrow({
    where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
  });
  const category = await database.cfpCategory.create({
    data: { eventId: event.id, key: "design", label: "Game design" },
  });
  return { id: event.id, slug, designCategoryId: category.id, formVersionId: version.id };
}

async function createSubmission({
  event,
  index,
  name,
  status,
  audience,
  categoryId,
}: {
  readonly event: SeededEvent;
  readonly index: number;
  readonly name: string;
  readonly status: CfpSubmissionStatus;
  readonly audience: string;
  readonly categoryId?: string;
}) {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@example.test`;
  const speaker = await database.speaker.create({
    data: {
      eventId: event.id,
      normalizedEmail: email,
      profileVersions: {
        create: {
          versionNumber: 1,
          email,
          givenName: name.split(" ")[0] ?? name,
          familyName: name.split(" ").slice(1).join(" ") || "Speaker",
          preferredName: name,
        },
      },
    },
  });
  const submittedAt = new Date(Date.UTC(2027, 2, 13, 18, 0, 25 - index));
  const lifecycleTimestamps: { reviewStartedAt?: Date; decidedAt?: Date } = {};
  if (status === CfpSubmissionStatus.UNDER_REVIEW || status === CfpSubmissionStatus.ACCEPTED) {
    lifecycleTimestamps.reviewStartedAt = new Date(submittedAt.getTime() + 60_000);
  }
  if (status === CfpSubmissionStatus.ACCEPTED) {
    lifecycleTimestamps.decidedAt = new Date(submittedAt.getTime() + 120_000);
  }
  const submission = await database.cfpSubmission.create({
    data: {
      eventId: event.id,
      formVersionId: event.formVersionId,
      kind: CfpSubmissionKind.ABSTRACT,
      status,
      submittedAt,
      ...lifecycleTimestamps,
      revisions: {
        create: {
          versionNumber: 1,
          kind: CfpSubmissionRevisionKind.FINAL,
          formVersionId: event.formVersionId,
          definitionSnapshot: JSON.parse(JSON.stringify(definition)) as Prisma.InputJsonValue,
          answers: { create: { questionId: "audience", sortOrder: 0, value: audience } },
        },
      },
    },
  });
  await Promise.all([
    database.cfpSubmissionParticipant.create({
      data: { eventId: event.id, submissionId: submission.id, speakerId: speaker.id, sortOrder: 0 },
    }),
    categoryId
      ? database.cfpSubmissionCategory.create({
          data: { eventId: event.id, submissionId: submission.id, categoryId, sortOrder: 0 },
        })
      : Promise.resolve(),
  ]);
}

async function seed() {
  await database.event.deleteMany({ where: { slug: { in: Object.values(eventSlugs) } } });
  const emptyEvent = await createEvent(eventSlugs.empty, "2027-01-01T17:00:00.000Z");
  const largeEvent = await createEvent(eventSlugs.large, "2027-03-13T17:00:00.000Z");

  for (let index = 0; index < 25; index += 1) {
    let name = `Speaker ${index + 1}`;
    let status: CfpSubmissionStatus = CfpSubmissionStatus.SUBMITTED;
    let audience = `Audience ${index + 1}`;
    if (index === 0) {
      name = "Lex Formula";
      status = CfpSubmissionStatus.ACCEPTED;
      audience = "=2+2";
    } else if (index === 1) {
      name = "Morgan Review";
      status = CfpSubmissionStatus.UNDER_REVIEW;
      audience = "Reviewers";
    }
    await createSubmission({
      event: largeEvent,
      index,
      name,
      status,
      audience,
      categoryId: index === 0 || index % 2 === 0 ? largeEvent.designCategoryId : undefined,
    });
  }

  const otherEvent = await createEvent(eventSlugs.other, "2027-05-01T17:00:00.000Z");
  await createSubmission({
    event: otherEvent,
    index: 0,
    name: "Secret Other Event",
    status: CfpSubmissionStatus.ACCEPTED,
    audience: "Never export this",
    categoryId: otherEvent.designCategoryId,
  });
  return {
    emptyEvent: { id: emptyEvent.id, slug: emptyEvent.slug },
    largeEvent: { id: largeEvent.id, slug: largeEvent.slug, designCategoryId: largeEvent.designCategoryId },
  };
}

async function signIn() {
  const links: string[] = [];
  const auth = createAuth({
    baseURL,
    database,
    isAllowedEmail: (email) => email.toLowerCase() === adminEmail,
    secret: authSecret,
    sendMagicLink: async ({ url }) => {
      links.push(url);
    },
  });
  const requested = await auth.handler(
    new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: adminEmail, callbackURL: "/dashboard" }),
    }),
  );
  if (requested.status !== 200) throw new Error(`Magic-link sign-in returned ${requested.status}.`);
  const link = links[0];
  if (!link) throw new Error("Expected the submission-table administrator magic link to be delivered.");
  const verified = await auth.handler(new Request(link, { redirect: "manual" }));
  const value = (verified.headers.get("set-cookie") ?? "").match(/better-auth\.session_token=([^;]+)/)?.[1];
  if (!value) throw new Error("Expected Better Auth to create a submission-table browser session cookie.");
  await grantSeededOrganizationAccess("admin@example.test");
  return { value };
}

async function cleanup() {
  await database.event.deleteMany({ where: { slug: { in: Object.values(eventSlugs) } } });
  await database.session.deleteMany({ where: { user: { email: adminEmail } } });
  await database.user.deleteMany({ where: { email: adminEmail } });
  return { cleaned: true };
}

ensureTestDatabase();
await database.$connect();
try {
  const command = process.argv[2];
  let result: unknown;
  if (command === "seed") result = await seed();
  else if (command === "sign-in") result = await signIn();
  else if (command === "cleanup") result = await cleanup();
  else throw new Error(`Unknown submission fixture command: ${command ?? "missing"}.`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await database.$disconnect();
}
