import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  EvaluationAssignmentStatus,
  EvaluationDecisionOutcome,
  EvaluationStatus,
  EventType,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for evaluation persistence integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

interface EvaluationFixture {
  readonly eventId: string;
  readonly submissionId: string;
  readonly planVersionId: string;
  readonly firstRoundId: string;
  readonly secondRoundId: string;
  readonly firstCriterionId: string;
  readonly secondCriterionId: string;
  readonly reviewerId: string;
  readonly committeeId: string;
}

async function createFixture(slug: string): Promise<EvaluationFixture> {
  const event = await client.event.create({
    data: {
      name: `Board to Death ${slug}`,
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-15T00:00:00.000Z"),
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
    include: { cfpForms: { include: { versions: true } } },
  });
  const formVersion = event.cfpForms[0]?.versions[0];
  assert.ok(formVersion);
  const submission = await client.cfpSubmission.create({
    data: { eventId: event.id, formVersionId: formVersion.id, kind: CfpSubmissionKind.ABSTRACT },
  });
  const plan = await client.evaluationPlan.create({
    data: {
      eventId: event.id,
      key: "main-evaluation",
      versions: {
        create: { versionNumber: 1, title: "2027 evaluation plan" },
      },
    },
    include: { versions: true },
  });
  const planVersion = plan.versions[0];
  assert.ok(planVersion);
  const firstRound = await client.evaluationRound.create({
    data: {
      planVersionId: planVersion.id,
      key: "screening",
      title: "Screening",
      sortOrder: 0,
      criteria: {
        create: { key: "clarity", label: "Clarity", sortOrder: 0, minimum: 1, maximum: 5 },
      },
    },
    include: { criteria: true },
  });
  const secondRound = await client.evaluationRound.create({
    data: {
      planVersionId: planVersion.id,
      key: "committee",
      title: "Committee review",
      sortOrder: 1,
      criteria: {
        create: { key: "fit", label: "Program fit", sortOrder: 0, minimum: 1, maximum: 10, weight: 2 },
      },
    },
    include: { criteria: true },
  });
  const reviewer = await client.evaluationReviewer.create({
    data: {
      eventId: event.id,
      identityId: `reviewer-${slug}`,
      email: `${slug}@example.test`,
      displayName: "Casey Reviewer",
    },
  });
  const committee = await client.evaluationCommittee.create({
    data: {
      eventId: event.id,
      key: "program-committee",
      name: "Program committee",
      members: { create: { reviewerId: reviewer.id, role: "chair" } },
    },
  });
  const firstCriterion = firstRound.criteria[0];
  const secondCriterion = secondRound.criteria[0];
  assert.ok(firstCriterion);
  assert.ok(secondCriterion);

  return {
    eventId: event.id,
    submissionId: submission.id,
    planVersionId: planVersion.id,
    firstRoundId: firstRound.id,
    secondRoundId: secondRound.id,
    firstCriterionId: firstCriterion.id,
    secondCriterionId: secondCriterion.id,
    reviewerId: reviewer.id,
    committeeId: committee.id,
  };
}

describe("evaluation persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("persists ordered rounds, rubric criteria, committees, and independent multi-round assignments", async () => {
    const fixture = await createFixture("multi-round");
    await client.evaluationAssignment.createMany({
      data: [
        {
          roundId: fixture.firstRoundId,
          submissionId: fixture.submissionId,
          reviewerId: fixture.reviewerId,
        },
        {
          roundId: fixture.secondRoundId,
          submissionId: fixture.submissionId,
          reviewerId: fixture.reviewerId,
          committeeId: fixture.committeeId,
        },
      ],
    });

    const stored = await client.evaluationPlanVersion.findUniqueOrThrow({
      where: { id: fixture.planVersionId },
      include: {
        rounds: {
          orderBy: { sortOrder: "asc" },
          include: { criteria: { orderBy: { sortOrder: "asc" } }, assignments: true },
        },
      },
    });
    const membership = await client.evaluationCommitteeMember.findUniqueOrThrow({
      where: {
        committeeId_reviewerId: { committeeId: fixture.committeeId, reviewerId: fixture.reviewerId },
      },
    });

    assert.deepEqual(
      stored.rounds.map((round) => [round.key, round.criteria.map((criterion) => criterion.key)]),
      [
        ["screening", ["clarity"]],
        ["committee", ["fit"]],
      ],
    );
    assert.deepEqual(
      stored.rounds.map((round) => round.assignments.length),
      [1, 1],
    );
    assert.equal(membership.role, "chair");
  });

  test("finalizes an evaluation while preserving completed results from an earlier round", async () => {
    const fixture = await createFixture("finalization");
    const firstAssignment = await client.evaluationAssignment.create({
      data: {
        roundId: fixture.firstRoundId,
        submissionId: fixture.submissionId,
        reviewerId: fixture.reviewerId,
      },
    });
    const draft = await client.evaluation.create({
      data: {
        assignmentId: firstAssignment.id,
        overallNote: "Promising proposal",
        results: { create: { criterionId: fixture.firstCriterionId, score: 4, note: "Clearly explained" } },
      },
    });
    const submittedAt = new Date("2027-01-20T18:00:00.000Z");
    await client.$transaction([
      client.evaluation.update({
        where: { id: draft.id },
        data: { status: EvaluationStatus.FINAL, submittedAt },
      }),
      client.evaluationAssignment.update({
        where: { id: firstAssignment.id },
        data: { status: EvaluationAssignmentStatus.COMPLETED, completedAt: submittedAt },
      }),
    ]);
    const secondAssignment = await client.evaluationAssignment.create({
      data: {
        roundId: fixture.secondRoundId,
        submissionId: fixture.submissionId,
        reviewerId: fixture.reviewerId,
        committeeId: fixture.committeeId,
        evaluation: {
          create: { results: { create: { criterionId: fixture.secondCriterionId, score: 8 } } },
        },
      },
    });

    const assignments = await client.evaluationAssignment.findMany({
      where: { submissionId: fixture.submissionId },
      orderBy: { assignedAt: "asc" },
      include: { evaluation: { include: { results: true } } },
    });

    assert.equal(assignments.length, 2);
    assert.equal(assignments[0]?.status, EvaluationAssignmentStatus.COMPLETED);
    assert.equal(assignments[0]?.evaluation?.status, EvaluationStatus.FINAL);
    assert.equal(assignments[0]?.evaluation?.results[0]?.score?.toString(), "4");
    assert.equal(assignments[1]?.id, secondAssignment.id);
    assert.equal(assignments[1]?.evaluation?.status, EvaluationStatus.DRAFT);
    await assert.rejects(
      client.evaluation.update({ where: { id: draft.id }, data: { submittedAt: null } }),
      /evaluations_status_timestamp/,
    );
  });

  test("keeps an ordered decision history when an administrator supersedes an outcome", async () => {
    const fixture = await createFixture("decisions");
    const waitlist = await client.evaluationDecision.create({
      data: {
        planVersionId: fixture.planVersionId,
        roundId: fixture.secondRoundId,
        submissionId: fixture.submissionId,
        decisionNumber: 1,
        outcome: EvaluationDecisionOutcome.WAITLISTED,
        decidedBy: "admin-1",
        rationale: "Awaiting a larger room",
      },
    });
    await client.evaluationDecision.create({
      data: {
        planVersionId: fixture.planVersionId,
        roundId: fixture.secondRoundId,
        submissionId: fixture.submissionId,
        decisionNumber: 2,
        outcome: EvaluationDecisionOutcome.ACCEPTED,
        supersedesDecisionId: waitlist.id,
        decidedBy: "admin-2",
        rationale: "A suitable room became available",
      },
    });

    const history = await client.evaluationDecision.findMany({
      where: { submissionId: fixture.submissionId },
      orderBy: { decisionNumber: "asc" },
      include: { supersedes: true },
    });

    assert.deepEqual(
      history.map(({ decisionNumber, outcome }) => [decisionNumber, outcome]),
      [
        [1, EvaluationDecisionOutcome.WAITLISTED],
        [2, EvaluationDecisionOutcome.ACCEPTED],
      ],
    );
    assert.equal(history[1]?.supersedes?.id, waitlist.id);
    await assert.rejects(
      client.evaluationDecision.create({
        data: {
          planVersionId: fixture.planVersionId,
          submissionId: fixture.submissionId,
          decisionNumber: 2,
          outcome: EvaluationDecisionOutcome.REJECTED,
          decidedBy: "admin-3",
        },
      }),
    );
  });
});
