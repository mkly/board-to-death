import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  EvaluationDecisionOutcome,
  EvaluationPlanVersionStatus,
  EvaluationRoundStatus,
  EvaluationStatus,
  EventType,
  PrismaClient,
  ReviewerVisibility,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { EvaluationDecisionRepository } from "./decisions.ts";
import { EvaluationResultsRepository } from "./results.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for evaluation decision integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const decisions = new EvaluationDecisionRepository(client);
const results = new EvaluationResultsRepository(client);

const decisionDefinition = {
  version: 1,
  title: "Program CFP",
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

async function expectRepositoryError(promise: Promise<unknown>, code?: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof RepositoryError && (code === undefined || error.code === code),
  );
}

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: `Decision ${slug}`,
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-06-01T16:00:00.000Z"),
      endsAt: new Date("2027-06-03T00:00:00.000Z"),
      cfpForms: {
        create: {
          key: "main-cfp",
          versions: { create: { versionNumber: 1, schemaVersion: 1, title: "Program CFP", customTypes: [] } },
        },
      },
    },
    include: { cfpForms: { include: { versions: true } } },
  });
}

describe("final evaluation decisions", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("records every outcome, supersedes waitlists, and rejects stale or ineligible requests", async () => {
    const [event, otherEvent] = await Promise.all([createEvent("main"), createEvent("other")]);
    const formVersion = event.cfpForms[0]?.versions[0];
    assert.ok(formVersion);
    const submissions = await Promise.all(
      ["waitlist", "accept", "reject", "incomplete", "guaranteed"].map((label) =>
        client.cfpSubmission.create({
          data: {
            eventId: event.id,
            formVersionId: formVersion.id,
            kind: label === "guaranteed" ? CfpSubmissionKind.GUARANTEED_SESSION : CfpSubmissionKind.ABSTRACT,
            status: CfpSubmissionStatus.UNDER_REVIEW,
            submittedAt: new Date("2027-04-01T18:00:00.000Z"),
            reviewStartedAt: new Date("2027-04-02T18:00:00.000Z"),
            intakeClientIdentifier: label,
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
    const [waitlistedSubmission, acceptedSubmission, rejectedSubmission, incompleteSubmission, guaranteedSubmission] =
      submissions;
    assert.ok(
      waitlistedSubmission && acceptedSubmission && rejectedSubmission && incompleteSubmission && guaranteedSubmission,
    );

    const plan = await client.evaluationPlan.create({
      data: {
        eventId: event.id,
        key: "final-review",
        versions: {
          create: {
            versionNumber: 1,
            title: "Final review",
            status: EvaluationPlanVersionStatus.ACTIVE,
            activatedAt: new Date("2027-04-03T18:00:00.000Z"),
          },
        },
      },
      include: { versions: true },
    });
    const planVersion = plan.versions[0];
    assert.ok(planVersion);
    const round = await client.evaluationRound.create({
      data: {
        planVersionId: planVersion.id,
        key: "final",
        title: "Final round",
        sortOrder: 0,
        status: EvaluationRoundStatus.OPEN,
        reviewerVisibility: ReviewerVisibility.IDENTIFIED,
        visibilitySnapshot: ReviewerVisibility.IDENTIFIED,
        opensAt: new Date("2027-04-04T18:00:00.000Z"),
      },
    });
    const reviewer = await client.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: "decision-reviewer",
        email: "reviewer@decision.test",
        displayName: "Decision Reviewer",
      },
    });
    const completedAt = new Date("2027-04-05T18:00:00.000Z");
    await Promise.all(
      submissions.map((submission, index) =>
        client.evaluationAssignment.create({
          data: {
            roundId: round.id,
            submissionId: submission.id,
            reviewerId: reviewer.id,
            status: index === 3 ? EvaluationAssignmentStatus.ASSIGNED : EvaluationAssignmentStatus.COMPLETED,
            completedAt: index === 3 ? null : completedAt,
            evaluation:
              index === 3 ? undefined : { create: { status: EvaluationStatus.FINAL, submittedAt: completedAt } },
          },
        }),
      ),
    );

    const waitlistInput = {
      eventId: event.id,
      roundId: round.id,
      submissionId: waitlistedSubmission.id,
      outcome: EvaluationDecisionOutcome.WAITLISTED,
      expectedDecisionNumber: 0,
      actorId: "admin-1",
    } as const;
    const [firstWaitlist, repeatedWaitlist] = await Promise.all([
      decisions.record(waitlistInput),
      decisions.record(waitlistInput),
    ]);
    assert.equal(repeatedWaitlist.id, firstWaitlist.id);

    const accepted = await decisions.record({
      eventId: event.id,
      roundId: round.id,
      submissionId: acceptedSubmission.id,
      outcome: EvaluationDecisionOutcome.ACCEPTED,
      expectedDecisionNumber: 0,
      actorId: "admin-1",
    });
    const rejected = await decisions.record({
      eventId: event.id,
      roundId: round.id,
      submissionId: rejectedSubmission.id,
      outcome: EvaluationDecisionOutcome.REJECTED,
      expectedDecisionNumber: 0,
      actorId: "admin-1",
    });
    assert.equal(accepted.decisionNumber, 1);
    assert.equal(rejected.decisionNumber, 1);
    assert.equal(
      await client.programSession.count({
        where: { sourceSubmissionId: { in: [waitlistedSubmission.id, acceptedSubmission.id] } },
      }),
      1,
    );

    const converted = await decisions.record({
      ...waitlistInput,
      outcome: EvaluationDecisionOutcome.ACCEPTED,
      expectedDecisionNumber: 1,
      rationale: "A program slot became available.",
    });
    const repeatedConversion = await decisions.record({
      ...waitlistInput,
      outcome: EvaluationDecisionOutcome.ACCEPTED,
      expectedDecisionNumber: 1,
      rationale: "A program slot became available.",
    });
    assert.equal(repeatedConversion.id, converted.id);
    assert.equal(converted.supersedesDecisionId, firstWaitlist.id);

    const acceptedGuaranteed = await decisions.record({
      eventId: event.id,
      roundId: round.id,
      submissionId: guaranteedSubmission.id,
      outcome: EvaluationDecisionOutcome.ACCEPTED,
      expectedDecisionNumber: 0,
      actorId: "admin-1",
    });
    assert.equal(acceptedGuaranteed.decisionNumber, 1);
    assert.equal(
      (await client.cfpSubmission.findUniqueOrThrow({ where: { id: guaranteedSubmission.id } })).status,
      CfpSubmissionStatus.ACCEPTED,
    );
    assert.equal(await client.programSession.count({ where: { sourceSubmissionId: guaranteedSubmission.id } }), 0);
    assert.equal(
      await client.programSession.count({
        where: { sourceSubmissionId: { in: [waitlistedSubmission.id, acceptedSubmission.id] } },
      }),
      2,
    );

    await expectRepositoryError(
      decisions.record({
        ...waitlistInput,
        outcome: EvaluationDecisionOutcome.REJECTED,
        expectedDecisionNumber: 1,
      }),
      "conflict",
    );
    await expectRepositoryError(
      decisions.record({
        eventId: event.id,
        roundId: round.id,
        submissionId: incompleteSubmission.id,
        outcome: EvaluationDecisionOutcome.ACCEPTED,
        expectedDecisionNumber: 0,
        actorId: "admin-1",
      }),
      "invalid-input",
    );
    await expectRepositoryError(
      decisions.record({
        eventId: otherEvent.id,
        roundId: round.id,
        submissionId: acceptedSubmission.id,
        outcome: EvaluationDecisionOutcome.ACCEPTED,
        expectedDecisionNumber: 0,
        actorId: "admin-2",
      }),
      "not-found",
    );

    const history = await client.evaluationDecision.findMany({
      where: { submissionId: waitlistedSubmission.id },
      orderBy: { decisionNumber: "asc" },
    });
    assert.deepEqual(
      history.map(({ decisionNumber, outcome }) => [decisionNumber, outcome]),
      [
        [1, EvaluationDecisionOutcome.WAITLISTED],
        [2, EvaluationDecisionOutcome.ACCEPTED],
      ],
    );
    assert.equal(await client.cfpSubmissionTransition.count({ where: { submissionId: waitlistedSubmission.id } }), 2);

    const workspace = await results.getWorkspace(event.id, round.id);
    const statusById = new Map(
      await client.cfpSubmission
        .findMany({
          where: { eventId: event.id },
          select: { id: true, status: true },
        })
        .then((rows) => rows.map(({ id, status }) => [id, status])),
    );
    assert.equal(statusById.get(waitlistedSubmission.id), CfpSubmissionStatus.ACCEPTED);
    assert.equal(statusById.get(acceptedSubmission.id), CfpSubmissionStatus.ACCEPTED);
    assert.equal(statusById.get(rejectedSubmission.id), CfpSubmissionStatus.REJECTED);
    assert.equal(statusById.get(incompleteSubmission.id), CfpSubmissionStatus.UNDER_REVIEW);
    assert.equal(workspace.submissions.find(({ id }) => id === waitlistedSubmission.id)?.decision?.decisionNumber, 2);
    assert.deepEqual(
      workspace.submissions.find(({ id }) => id === incompleteSubmission.id)?.availableDecisionOutcomes,
      [],
    );
  });
});
