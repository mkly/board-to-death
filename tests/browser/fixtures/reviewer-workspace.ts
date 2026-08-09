import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationRoundStatus,
  EventType,
  PrismaClient,
  ReviewerVisibility,
} from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { randomUUID } from "node:crypto";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createSession(email: string): Promise<{ readonly token: string; readonly userId: string }> {
  const links: string[] = [];
  const auth = createAuth({
    baseURL,
    database,
    isAllowedEmail: (candidate) => candidate.toLowerCase() === email,
    secret: "quality-gate-better-auth-secret-at-least-32-characters",
    sendMagicLink: async ({ url }) => {
      links.push(url);
    },
  });
  const response = await auth.handler(
    new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email, callbackURL: "/reviews" }),
    }),
  );
  if (response.status !== 200) throw new Error(`Magic-link sign-in returned ${response.status}.`);
  const link = links[0];
  if (!link) throw new Error("Expected a reviewer magic link.");
  const verified = await auth.handler(new Request(link, { redirect: "manual" }));
  const token = (verified.headers.get("set-cookie") ?? "").match(/better-auth\.session_token=([^;]+)/)?.[1];
  if (!token) throw new Error("Expected a reviewer session cookie.");
  const session = await auth.api.getSession({ headers: new Headers({ cookie: `better-auth.session_token=${token}` }) });
  if (!session) throw new Error("Expected a reviewer session.");
  return { token, userId: session.user.id };
}

const definitionSnapshot = {
  version: 1,
  title: "Reviewer browser CFP",
  sections: [
    {
      id: "speaker",
      kind: "speaker",
      title: "Speaker",
      questions: [{ id: "speaker-name", type: "short_text", label: "Speaker name", required: true }],
    },
    {
      id: "proposal",
      kind: "questions",
      title: "Proposal",
      questions: [{ id: "abstract", type: "long_text", label: "Abstract", required: true }],
    },
  ],
};

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const [reviewerSession, emptySession, otherSession] = await Promise.all([
    createSession(`reviewer-${suffix}@example.test`),
    createSession(`empty-reviewer-${suffix}@example.test`),
    createSession(`other-reviewer-${suffix}@example.test`),
  ]);
  const event = await database.event.create({
    data: {
      name: "Reviewer Browser Summit",
      slug: `reviewer-browser-${suffix}`,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-05-01T16:00:00.000Z"),
      endsAt: new Date("2027-05-03T00:00:00.000Z"),
      cfpForms: {
        create: {
          key: "reviewer-browser-cfp",
          versions: { create: { versionNumber: 1, schemaVersion: 1, title: "Reviewer browser CFP", customTypes: [] } },
        },
      },
    },
    include: { cfpForms: { include: { versions: true } } },
  });
  const formVersion = event.cfpForms[0]?.versions[0];
  if (!formVersion) throw new Error("Expected a CFP form version.");
  const speaker = await database.speaker.create({
    data: {
      eventId: event.id,
      normalizedEmail: `ada-${suffix}@example.test`,
      profileVersions: {
        create: {
          versionNumber: 1,
          email: `ada-${suffix}@example.test`,
          givenName: "Ada",
          familyName: "Applicant",
          preferredName: "Ada Applicant",
        },
      },
    },
  });
  const submissions = await Promise.all(
    ["Identified proposal", "Blind proposal", "Anonymized proposal", "Other reviewer proposal"].map((abstract, index) =>
      database.cfpSubmission.create({
        data: {
          eventId: event.id,
          formVersionId: formVersion.id,
          kind: CfpSubmissionKind.ABSTRACT,
          status: CfpSubmissionStatus.UNDER_REVIEW,
          submittedAt: new Date(`2027-03-0${index + 1}T18:00:00.000Z`),
          reviewStartedAt: new Date("2027-03-06T18:00:00.000Z"),
          participants: { create: { speakerId: speaker.id, sortOrder: 0 } },
          revisions: {
            create: {
              versionNumber: 1,
              kind: CfpSubmissionRevisionKind.FINAL,
              formVersionId: formVersion.id,
              definitionSnapshot,
              answers: {
                create: [
                  { questionId: "speaker-name", sortOrder: 0, value: "Ada Applicant" },
                  { questionId: "abstract", sortOrder: 1, value: abstract },
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
      key: "browser-review-plan",
      versions: {
        create: {
          versionNumber: 1,
          title: "Browser program review",
          status: EvaluationPlanVersionStatus.DRAFT,
        },
      },
    },
    include: { versions: true },
  });
  const planVersion = plan.versions[0];
  if (!planVersion) throw new Error("Expected an evaluation plan version.");
  const rounds = await Promise.all(
    [ReviewerVisibility.IDENTIFIED, ReviewerVisibility.BLIND, ReviewerVisibility.ANONYMIZED].map((visibility, index) =>
      database.evaluationRound.create({
        data: {
          planVersionId: planVersion.id,
          key: `${visibility.toLowerCase()}-${suffix}`,
          title: `${visibility[0]}${visibility.slice(1).toLowerCase()} round`,
          sortOrder: index,
          status: EvaluationRoundStatus.OPEN,
          reviewerVisibility: visibility,
          visibilitySnapshot: visibility,
          opensAt: new Date("2027-03-01T18:00:00.000Z"),
          criteria: {
            create: {
              key: "clarity",
              label: "Clarity",
              description: "Judge how clearly the proposal states its outcome.",
              sortOrder: 0,
              weight: 1,
              minimum: 1,
              maximum: 5,
            },
          },
        },
      }),
    ),
  );
  const [identifiedRound, blindRound, anonymizedRound] = rounds;
  if (!identifiedRound || !blindRound || !anonymizedRound) throw new Error("Expected three review rounds.");
  await database.evaluationPlanVersion.update({
    where: { id: planVersion.id },
    data: { status: EvaluationPlanVersionStatus.ACTIVE, activatedAt: new Date("2027-03-01T18:00:00.000Z") },
  });
  const [reviewer, emptyReviewer, otherReviewer] = await Promise.all([
    database.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: reviewerSession.userId,
        email: `reviewer-${suffix}@example.test`,
        displayName: "Riley Reviewer",
      },
    }),
    database.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: emptySession.userId,
        email: `empty-reviewer-${suffix}@example.test`,
        displayName: "Empty Reviewer",
      },
    }),
    database.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: otherSession.userId,
        email: `other-reviewer-${suffix}@example.test`,
        displayName: "Other Reviewer",
      },
    }),
  ]);
  void emptyReviewer;
  const committee = await database.evaluationCommittee.create({
    data: {
      eventId: event.id,
      key: `program-committee-${suffix}`,
      name: "Program committee",
      members: { create: { reviewerId: reviewer.id } },
    },
  });
  const [identifiedSubmission, blindSubmission, anonymizedSubmission, otherSubmission] = submissions;
  if (!identifiedSubmission || !blindSubmission || !anonymizedSubmission || !otherSubmission) {
    throw new Error("Expected four reviewer submissions.");
  }
  const [identified, blind, anonymized, other] = await Promise.all([
    database.evaluationAssignment.create({
      data: { roundId: identifiedRound.id, submissionId: identifiedSubmission.id, reviewerId: reviewer.id },
    }),
    database.evaluationAssignment.create({
      data: {
        roundId: blindRound.id,
        submissionId: blindSubmission.id,
        reviewerId: reviewer.id,
        committeeId: committee.id,
      },
    }),
    database.evaluationAssignment.create({
      data: { roundId: anonymizedRound.id, submissionId: anonymizedSubmission.id, reviewerId: reviewer.id },
    }),
    database.evaluationAssignment.create({
      data: { roundId: blindRound.id, submissionId: otherSubmission.id, reviewerId: otherReviewer.id },
    }),
  ]);

  return {
    eventId: event.id,
    reviewerToken: reviewerSession.token,
    emptyReviewerToken: emptySession.token,
    identifiedAssignmentId: identified.id,
    blindAssignmentId: blind.id,
    anonymizedAssignmentId: anonymized.id,
    otherAssignmentId: other.id,
    blindRoundId: blindRound.id,
  };
}

const action = process.argv[2];
try {
  await database.$connect();
  if (action === "setup") {
    process.stdout.write(JSON.stringify(await setup()));
  } else if (action === "close-round") {
    const roundId = process.argv[3];
    if (!roundId) throw new Error("roundId is required.");
    await database.evaluationRound.update({
      where: { id: roundId },
      data: { status: EvaluationRoundStatus.CLOSED, closesAt: new Date("2027-03-10T18:00:00.000Z") },
    });
  } else if (action === "revoke-assignment") {
    const assignmentId = process.argv[3];
    if (!assignmentId) throw new Error("assignmentId is required.");
    await database.evaluationAssignment.update({
      where: { id: assignmentId },
      data: { status: EvaluationAssignmentStatus.REVOKED, revokedAt: new Date() },
    });
  } else if (action === "cleanup") {
    const eventId = process.argv[3];
    if (!eventId) throw new Error("eventId is required.");
    await database.event.delete({ where: { id: eventId } });
  } else {
    throw new Error(`Unknown fixture action: ${action ?? "missing"}`);
  }
} finally {
  await database.$disconnect();
}
