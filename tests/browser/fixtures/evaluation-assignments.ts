import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionStatus,
  EvaluationPlanVersionStatus,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  EventType,
  PrismaClient,
} from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createAdministratorSession(): Promise<string> {
  const links: string[] = [];
  const auth = createAuth({
    baseURL,
    database,
    isAllowedEmail: (email) => email.toLowerCase() === "admin@example.test",
    secret: "quality-gate-better-auth-secret-at-least-32-characters",
    sendMagicLink: async ({ url }) => {
      links.push(url);
    },
  });
  const signIn = await auth.handler(
    new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: "admin@example.test", callbackURL: "/dashboard" }),
    }),
  );
  if (signIn.status !== 200) throw new Error(`Magic-link sign-in returned ${signIn.status}.`);
  const link = links[0];
  if (!link) throw new Error("Expected the browser administrator magic link to be delivered.");
  const verified = await auth.handler(new Request(link, { redirect: "manual" }));
  const match = (verified.headers.get("set-cookie") ?? "").match(/better-auth\.session_token=([^;]+)/);
  if (!match?.[1]) throw new Error("Expected Better Auth to create a browser session cookie.");
  return match[1];
}

async function setup() {
  await database.event.deleteMany();
  await database.verification.deleteMany();
  await database.account.deleteMany();
  await database.session.deleteMany();
  await database.user.deleteMany();

  const event = await database.event.create({
    data: {
      name: "Browser Review Summit",
      slug: "browser-review-summit",
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-15T00:00:00.000Z"),
      cfpCategories: { create: { key: "strategy", label: "Strategy games" } },
      cfpForms: {
        create: {
          key: "main-cfp",
          versions: {
            create: {
              versionNumber: 1,
              schemaVersion: 1,
              title: "Board Game Design CFP",
              customTypes: [],
            },
          },
        },
      },
    },
    include: { cfpCategories: true, cfpForms: { include: { versions: true } } },
  });
  const formVersion = event.cfpForms[0]?.versions[0];
  const category = event.cfpCategories[0];
  if (!formVersion || !category) throw new Error("Expected the browser CFP fixture to be created.");
  await Promise.all([
    database.cfpSubmission.create({
      data: {
        eventId: event.id,
        formVersionId: formVersion.id,
        kind: CfpSubmissionKind.ABSTRACT,
        status: CfpSubmissionStatus.SUBMITTED,
        submittedAt: new Date("2027-01-10T18:00:00.000Z"),
        categories: { create: { categoryId: category.id, sortOrder: 0 } },
      },
    }),
    database.cfpSubmission.create({
      data: {
        eventId: event.id,
        formVersionId: formVersion.id,
        kind: CfpSubmissionKind.ABSTRACT,
        status: CfpSubmissionStatus.UNDER_REVIEW,
        submittedAt: new Date("2027-01-11T18:00:00.000Z"),
        reviewStartedAt: new Date("2027-01-12T18:00:00.000Z"),
      },
    }),
  ]);

  const plan = await database.evaluationPlan.create({
    data: {
      eventId: event.id,
      key: "main-evaluation",
      versions: {
        create: {
          versionNumber: 1,
          title: "2027 evaluation plan",
          status: EvaluationPlanVersionStatus.ACTIVE,
          activatedAt: new Date("2027-01-01T18:00:00.000Z"),
        },
      },
    },
    include: { versions: true },
  });
  const planVersion = plan.versions[0];
  if (!planVersion) throw new Error("Expected the browser evaluation plan fixture to be created.");
  await database.evaluationRound.create({
    data: {
      planVersionId: planVersion.id,
      key: "screening",
      title: "Screening",
      sortOrder: 0,
      status: EvaluationRoundStatus.OPEN,
    },
  });
  const [sourceReviewer, targetReviewer] = await Promise.all([
    database.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: "browser-source",
        email: "alex@example.test",
        displayName: "Alex Source",
      },
    }),
    database.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: "browser-target",
        email: "bailey@example.test",
        displayName: "Bailey Target",
      },
    }),
  ]);

  return {
    eventId: event.id,
    eventSlug: event.slug,
    sourceReviewerId: sourceReviewer.id,
    targetReviewerId: targetReviewer.id,
    sessionToken: await createAdministratorSession(),
  };
}

const action = process.argv[2];
try {
  await database.$connect();
  if (action === "setup") {
    process.stdout.write(JSON.stringify(await setup()));
  } else if (action === "deactivate-reviewers") {
    const eventId = process.argv[3];
    if (!eventId) throw new Error("eventId is required to deactivate reviewers.");
    await database.evaluationReviewer.updateMany({
      where: { eventId },
      data: { status: EvaluationReviewerStatus.INACTIVE },
    });
  } else {
    throw new Error(`Unknown fixture action: ${action ?? "missing"}`);
  }
} finally {
  await database.$disconnect();
}
