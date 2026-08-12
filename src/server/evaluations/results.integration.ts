import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationRoundStatus,
  EvaluationStatus,
  EventType,
  PrismaClient,
  ReviewerVisibility,
} from "../../generated/prisma/client.ts";
import { EvaluationAssignmentRepository } from "./assignments.ts";
import { EvaluationResultsRepository } from "./results.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for evaluation results integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const repository = new EvaluationResultsRepository(client);
const assignmentRepository = new EvaluationAssignmentRepository(client);

interface Fixture {
  readonly eventId: string;
  readonly otherEventId: string;
  readonly roundId: string;
  readonly otherRoundId: string;
  readonly firstSubmissionId: string;
  readonly secondSubmissionId: string;
  readonly thirdSubmissionId: string;
  readonly otherSubmissionId: string;
  readonly reopenedAssignmentId: string;
}

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: `${slug} summit`,
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

async function createFixture(): Promise<Fixture> {
  const [event, otherEvent] = await Promise.all([createEvent("results-event"), createEvent("other-results-event")]);
  const formVersion = event.cfpForms[0]?.versions[0];
  const otherFormVersion = otherEvent.cfpForms[0]?.versions[0];
  assert.ok(formVersion && otherFormVersion);

  const submissions = await Promise.all(
    ["2027-04-01", "2027-04-02", "2027-04-03"].map((date) =>
      client.cfpSubmission.create({
        data: {
          eventId: event.id,
          formVersionId: formVersion.id,
          kind: CfpSubmissionKind.ABSTRACT,
          status: CfpSubmissionStatus.UNDER_REVIEW,
          submittedAt: new Date(`${date}T18:00:00.000Z`),
          reviewStartedAt: new Date("2027-04-04T18:00:00.000Z"),
        },
      }),
    ),
  );
  const otherSubmission = await client.cfpSubmission.create({
    data: {
      eventId: otherEvent.id,
      formVersionId: otherFormVersion.id,
      kind: CfpSubmissionKind.ABSTRACT,
      status: CfpSubmissionStatus.UNDER_REVIEW,
      submittedAt: new Date("2027-04-01T18:00:00.000Z"),
      reviewStartedAt: new Date("2027-04-02T18:00:00.000Z"),
    },
  });

  async function createRound(eventId: string, key: string) {
    const plan = await client.evaluationPlan.create({
      data: {
        eventId,
        key,
        versions: {
          create: {
            versionNumber: 1,
            title: "Activated program review",
            status: EvaluationPlanVersionStatus.DRAFT,
          },
        },
      },
      include: { versions: true },
    });
    const version = plan.versions[0];
    assert.ok(version);
    const round = await client.evaluationRound.create({
      data: {
        planVersionId: version.id,
        key: "screening",
        title: "Screening",
        sortOrder: 0,
        status: EvaluationRoundStatus.OPEN,
        reviewerVisibility: ReviewerVisibility.BLIND,
        visibilitySnapshot: ReviewerVisibility.BLIND,
        opensAt: new Date("2027-04-06T18:00:00.000Z"),
        criteria: {
          create: [
            { key: "clarity", label: "Clarity", sortOrder: 0, weight: 1, minimum: 1, maximum: 5 },
            {
              key: "novelty",
              label: "Novelty",
              sortOrder: 1,
              weight: 3,
              minimum: 1,
              maximum: 5,
              required: false,
            },
          ],
        },
      },
      include: { criteria: { orderBy: { sortOrder: "asc" } } },
    });
    await client.evaluationPlanVersion.update({
      where: { id: version.id },
      data: {
        status: EvaluationPlanVersionStatus.ACTIVE,
        activatedAt: new Date("2027-04-05T18:00:00.000Z"),
      },
    });
    return round;
  }

  const [round, otherRound] = await Promise.all([
    createRound(event.id, "results-plan"),
    createRound(otherEvent.id, "other-results-plan"),
  ]);
  const [clarity, novelty] = round.criteria;
  const [otherClarity] = otherRound.criteria;
  const [firstSubmission, secondSubmission, thirdSubmission] = submissions;
  assert.ok(clarity && novelty && otherClarity && firstSubmission && secondSubmission && thirdSubmission);

  const reviewers = await Promise.all(
    ["Avery", "Bailey", "Casey"].map((name) =>
      client.evaluationReviewer.create({
        data: {
          eventId: event.id,
          identityId: `${name.toLowerCase()}-results-reviewer`,
          email: `${name.toLowerCase()}@results.test`,
          displayName: `${name} Reviewer`,
        },
      }),
    ),
  );
  const [avery, bailey, casey] = reviewers;
  assert.ok(avery && bailey && casey);
  const otherReviewer = await client.evaluationReviewer.create({
    data: {
      eventId: otherEvent.id,
      identityId: "other-results-reviewer",
      email: "other@results.test",
      displayName: "Other Reviewer",
    },
  });

  const completedAt = new Date("2027-04-10T18:00:00.000Z");
  const completed = (submissionId: string, reviewerId: string, clarityScore: number, noveltyScore: number) =>
    client.evaluationAssignment.create({
      data: {
        roundId: round.id,
        submissionId,
        reviewerId,
        status: EvaluationAssignmentStatus.COMPLETED,
        completedAt,
        evaluation: {
          create: {
            status: EvaluationStatus.FINAL,
            submittedAt: completedAt,
            results: {
              create: [
                { criterionId: clarity.id, score: clarityScore },
                { criterionId: novelty.id, score: noveltyScore },
              ],
            },
          },
        },
      },
    });

  const [, , , reopenedAssignment] = await Promise.all([
    completed(firstSubmission.id, avery.id, 4, 5),
    client.evaluationAssignment.create({
      data: {
        roundId: round.id,
        submissionId: firstSubmission.id,
        reviewerId: bailey.id,
        evaluation: {
          create: {
            status: EvaluationStatus.DRAFT,
            results: {
              create: { criterionId: clarity.id, score: 2 },
            },
          },
        },
      },
    }),
    client.evaluationAssignment.create({
      data: {
        roundId: round.id,
        submissionId: firstSubmission.id,
        reviewerId: casey.id,
        status: EvaluationAssignmentStatus.RECUSED,
        recusedAt: completedAt,
        evaluation: {
          create: {
            status: EvaluationStatus.FINAL,
            submittedAt: completedAt,
            results: {
              create: [
                { criterionId: clarity.id, score: 1 },
                { criterionId: novelty.id, score: 1 },
              ],
            },
          },
        },
      },
    }),
    completed(secondSubmission.id, avery.id, 3, 5),
    completed(secondSubmission.id, bailey.id, 3, 5),
    client.evaluationAssignment.create({
      data: {
        roundId: round.id,
        submissionId: thirdSubmission.id,
        reviewerId: avery.id,
        evaluation: {
          create: {
            status: EvaluationStatus.DRAFT,
            results: { create: { criterionId: clarity.id, score: 3.333 } },
          },
        },
      },
    }),
    client.evaluationAssignment.create({
      data: {
        roundId: otherRound.id,
        submissionId: otherSubmission.id,
        reviewerId: otherReviewer.id,
        status: EvaluationAssignmentStatus.COMPLETED,
        completedAt,
        evaluation: {
          create: {
            status: EvaluationStatus.FINAL,
            submittedAt: completedAt,
            results: { create: { criterionId: otherClarity.id, score: 5 } },
          },
        },
      },
    }),
  ]);
  assert.ok(reopenedAssignment);

  return {
    eventId: event.id,
    otherEventId: otherEvent.id,
    roundId: round.id,
    otherRoundId: otherRound.id,
    firstSubmissionId: firstSubmission.id,
    secondSubmissionId: secondSubmission.id,
    thirdSubmissionId: thirdSubmission.id,
    otherSubmissionId: otherSubmission.id,
    reopenedAssignmentId: reopenedAssignment.id,
  };
}

describe("evaluation result aggregation", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("reports weighted scores without recused reviews, missing values, completion, reopen, and event isolation", async () => {
    const fixture = await createFixture();
    const workspace = await repository.getWorkspace(fixture.eventId, fixture.roundId);
    assert.equal(workspace.submissions.length, 3);

    const first = workspace.submissions.find(({ id }) => id === fixture.firstSubmissionId);
    const second = workspace.submissions.find(({ id }) => id === fixture.secondSubmissionId);
    const third = workspace.submissions.find(({ id }) => id === fixture.thirdSubmissionId);
    assert.ok(first && second && third);

    assert.deepEqual(
      {
        active: first.activeReviewerCount,
        complete: first.completedReviewerCount,
        incomplete: first.incompleteReviewerCount,
        withdrawn: first.withdrawnReviewerCount,
        weightedAverage: first.weightedAverage,
        rank: first.rank,
        tied: first.tied,
      },
      { active: 2, complete: 1, incomplete: 1, withdrawn: 1, weightedAverage: 4.75, rank: 1, tied: false },
    );
    assert.deepEqual(
      first.criteria.map(({ label, average, scoreCount, missingScoreCount }) => ({
        label,
        average,
        scoreCount,
        missingScoreCount,
      })),
      [
        { label: "Clarity", average: 4, scoreCount: 1, missingScoreCount: 1 },
        { label: "Novelty", average: 5, scoreCount: 1, missingScoreCount: 1 },
      ],
    );
    assert.deepEqual(
      { weightedAverage: second.weightedAverage, rank: second.rank, tied: second.tied },
      { weightedAverage: 4.5, rank: 2, tied: false },
    );
    assert.deepEqual(
      { weightedAverage: third.weightedAverage, rank: third.rank, tied: third.tied },
      { weightedAverage: null, rank: null, tied: false },
    );
    assert.ok(!workspace.submissions.some(({ id }) => id === fixture.otherSubmissionId));

    await assignmentRepository.reopenEvaluation(fixture.eventId, fixture.reopenedAssignmentId, {
      actorId: "results-admin",
      expectedEvaluationVersion: 1,
    });
    const reopened = await repository.getWorkspace(fixture.eventId, fixture.roundId);
    const reopenedSecond = reopened.submissions.find(({ id }) => id === fixture.secondSubmissionId);
    assert.ok(reopenedSecond);
    assert.equal(reopenedSecond.completedReviewerCount, 1);
    assert.equal(reopenedSecond.incompleteReviewerCount, 1);
    assert.equal(reopenedSecond.weightedAverage, 4.5);
    assert.deepEqual(
      reopenedSecond.criteria.map(({ scoreCount, missingScoreCount }) => ({ scoreCount, missingScoreCount })),
      [
        { scoreCount: 1, missingScoreCount: 1 },
        { scoreCount: 1, missingScoreCount: 1 },
      ],
      "returning an evaluation to draft excludes its saved scores from the aggregate",
    );

    await assert.rejects(repository.getWorkspace(fixture.eventId, fixture.otherRoundId), /not found for this event/);
    const otherWorkspace = await repository.getWorkspace(fixture.otherEventId);
    assert.equal(otherWorkspace.submissions.length, 1);
  });
});
