import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationRoundStatus,
  EvaluationStatus,
  EventType,
  PrismaClient,
  ReviewerVisibility,
} from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const decisionDefinition = {
  version: 1,
  title: "Decision CFP",
  sections: [
    {
      id: "proposal",
      kind: "questions",
      title: "Proposal",
      questions: [
        { id: "title", type: "short_text", label: "Proposal title", required: true },
        { id: "abstract", type: "long_text", label: "Abstract", required: true },
      ],
    },
  ],
} as const;

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
      name: "Browser Decision Summit",
      slug: "browser-decision-summit",
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-06-01T16:00:00.000Z"),
      endsAt: new Date("2027-06-03T00:00:00.000Z"),
      cfpForms: {
        create: {
          key: "main-cfp",
          versions: {
            create: { versionNumber: 1, schemaVersion: 1, title: "Decision CFP", customTypes: [] },
          },
        },
      },
    },
    include: { cfpForms: { include: { versions: true } } },
  });
  const formVersion = event.cfpForms[0]?.versions[0];
  if (!formVersion) throw new Error("Expected the decision CFP fixture to be created.");
  const submissions = await Promise.all(
    ["waitlist", "accept", "reject"].map((label, index) =>
      database.cfpSubmission.create({
        data: {
          eventId: event.id,
          formVersionId: formVersion.id,
          kind: CfpSubmissionKind.ABSTRACT,
          status: CfpSubmissionStatus.UNDER_REVIEW,
          submittedAt: new Date(`2027-04-0${index + 1}T18:00:00.000Z`),
          reviewStartedAt: new Date("2027-04-04T18:00:00.000Z"),
          intakeClientIdentifier: `browser-${label}`,
          revisions: {
            create: {
              versionNumber: 1,
              kind: CfpSubmissionRevisionKind.FINAL,
              formVersionId: formVersion.id,
              definitionSnapshot: decisionDefinition,
              answers: {
                create: [
                  { questionId: "title", sortOrder: 0, value: `${label} proposal` },
                  { questionId: "abstract", sortOrder: 1, value: `${label} abstract` },
                ],
              },
            },
          },
        },
      }),
    ),
  );
  const plan = await database.evaluationPlan.create({
    data: {
      eventId: event.id,
      key: "decision-plan",
      versions: {
        create: {
          versionNumber: 1,
          title: "Final program review",
          status: EvaluationPlanVersionStatus.ACTIVE,
          activatedAt: new Date("2027-04-05T18:00:00.000Z"),
        },
      },
    },
    include: { versions: true },
  });
  const planVersion = plan.versions[0];
  if (!planVersion) throw new Error("Expected the final evaluation plan fixture to be created.");
  const round = await database.evaluationRound.create({
    data: {
      planVersionId: planVersion.id,
      key: "final",
      title: "Final review",
      sortOrder: 0,
      status: EvaluationRoundStatus.OPEN,
      reviewerVisibility: ReviewerVisibility.IDENTIFIED,
      visibilitySnapshot: ReviewerVisibility.IDENTIFIED,
      opensAt: new Date("2027-04-06T18:00:00.000Z"),
    },
  });
  const reviewer = await database.evaluationReviewer.create({
    data: {
      eventId: event.id,
      identityId: "browser-decision-reviewer",
      email: "reviewer@browser-decision.test",
      displayName: "Final Reviewer",
    },
  });
  const completedAt = new Date("2027-04-07T18:00:00.000Z");
  await Promise.all(
    submissions.map((submission) =>
      database.evaluationAssignment.create({
        data: {
          roundId: round.id,
          submissionId: submission.id,
          reviewerId: reviewer.id,
          status: EvaluationAssignmentStatus.COMPLETED,
          completedAt,
          evaluation: { create: { status: EvaluationStatus.FINAL, submittedAt: completedAt } },
        },
      }),
    ),
  );

  return {
    eventId: event.id,
    eventSlug: event.slug,
    roundId: round.id,
    submissionIds: submissions.map(({ id }) => id),
    sessionToken: await createAdministratorSession(),
  };
}

try {
  await database.$connect();
  process.stdout.write(JSON.stringify(await setup()));
} finally {
  await database.$disconnect();
}
