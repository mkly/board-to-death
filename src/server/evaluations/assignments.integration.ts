import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  EventType,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { EvaluationAssignmentRepository } from "./assignments.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for reviewer assignment integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const repository = new EvaluationAssignmentRepository(client);

interface Fixture {
  readonly eventId: string;
  readonly otherEventId: string;
  readonly openRoundId: string;
  readonly plannedRoundId: string;
  readonly sourceReviewerId: string;
  readonly targetReviewerId: string;
  readonly inactiveReviewerId: string;
  readonly otherReviewerId: string;
  readonly firstSubmissionId: string;
  readonly secondSubmissionId: string;
  readonly draftSubmissionId: string;
  readonly otherSubmissionId: string;
}

async function createEvent(slug: string) {
  return client.event.create({
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
}

async function createFixture(): Promise<Fixture> {
  const [event, otherEvent] = await Promise.all([createEvent("review-assignments"), createEvent("other-reviewers")]);
  const formVersion = event.cfpForms[0]?.versions[0];
  const otherFormVersion = otherEvent.cfpForms[0]?.versions[0];
  assert.ok(formVersion);
  assert.ok(otherFormVersion);

  const [firstSubmission, secondSubmission, draftSubmission, otherSubmission] = await Promise.all([
    client.cfpSubmission.create({
      data: {
        eventId: event.id,
        formVersionId: formVersion.id,
        kind: CfpSubmissionKind.ABSTRACT,
        status: CfpSubmissionStatus.SUBMITTED,
        submittedAt: new Date("2027-01-10T18:00:00.000Z"),
      },
    }),
    client.cfpSubmission.create({
      data: {
        eventId: event.id,
        formVersionId: formVersion.id,
        kind: CfpSubmissionKind.ABSTRACT,
        status: CfpSubmissionStatus.UNDER_REVIEW,
        submittedAt: new Date("2027-01-11T18:00:00.000Z"),
        reviewStartedAt: new Date("2027-01-12T18:00:00.000Z"),
      },
    }),
    client.cfpSubmission.create({
      data: {
        eventId: event.id,
        formVersionId: formVersion.id,
        kind: CfpSubmissionKind.ABSTRACT,
        status: CfpSubmissionStatus.DRAFT,
      },
    }),
    client.cfpSubmission.create({
      data: {
        eventId: otherEvent.id,
        formVersionId: otherFormVersion.id,
        kind: CfpSubmissionKind.ABSTRACT,
        status: CfpSubmissionStatus.SUBMITTED,
        submittedAt: new Date("2027-01-10T18:00:00.000Z"),
      },
    }),
  ]);

  const plan = await client.evaluationPlan.create({
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
  assert.ok(planVersion);
  const [openRound, plannedRound] = await Promise.all([
    client.evaluationRound.create({
      data: {
        planVersionId: planVersion.id,
        key: "screening",
        title: "Screening",
        sortOrder: 0,
        status: EvaluationRoundStatus.OPEN,
      },
    }),
    client.evaluationRound.create({
      data: {
        planVersionId: planVersion.id,
        key: "committee",
        title: "Committee review",
        sortOrder: 1,
        status: EvaluationRoundStatus.PLANNED,
      },
    }),
  ]);
  const [sourceReviewer, targetReviewer, inactiveReviewer, otherReviewer] = await Promise.all([
    client.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: "source-reviewer",
        email: "source@example.test",
        displayName: "Alex Source",
      },
    }),
    client.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: "target-reviewer",
        email: "target@example.test",
        displayName: "Bailey Target",
      },
    }),
    client.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: "inactive-reviewer",
        email: "inactive@example.test",
        displayName: "Inactive Reviewer",
        status: EvaluationReviewerStatus.INACTIVE,
      },
    }),
    client.evaluationReviewer.create({
      data: {
        eventId: otherEvent.id,
        identityId: "other-reviewer",
        email: "other@example.test",
        displayName: "Other Reviewer",
      },
    }),
  ]);

  return {
    eventId: event.id,
    otherEventId: otherEvent.id,
    openRoundId: openRound.id,
    plannedRoundId: plannedRound.id,
    sourceReviewerId: sourceReviewer.id,
    targetReviewerId: targetReviewer.id,
    inactiveReviewerId: inactiveReviewer.id,
    otherReviewerId: otherReviewer.id,
    firstSubmissionId: firstSubmission.id,
    secondSubmissionId: secondSubmission.id,
    draftSubmissionId: draftSubmission.id,
    otherSubmissionId: otherSubmission.id,
  };
}

describe("individual reviewer assignments", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("bulk assigns eligible submissions and rejects a duplicate active assignment", async () => {
    const fixture = await createFixture();
    const submissionIds = [fixture.firstSubmissionId, fixture.secondSubmissionId];
    assert.equal(
      await repository.assign({
        eventId: fixture.eventId,
        roundId: fixture.openRoundId,
        reviewerId: fixture.sourceReviewerId,
        submissionIds,
      }),
      2,
    );

    const assignments = await client.evaluationAssignment.findMany({
      where: { roundId: fixture.openRoundId },
      orderBy: { submissionId: "asc" },
    });
    assert.equal(assignments.length, 2);
    assert.ok(assignments.every(({ status }) => status === EvaluationAssignmentStatus.ASSIGNED));
    await assert.rejects(
      repository.assign({
        eventId: fixture.eventId,
        roundId: fixture.openRoundId,
        reviewerId: fixture.sourceReviewerId,
        submissionIds: [fixture.firstSubmissionId],
      }),
      /already has an active assignment/,
    );
  });

  test("bulk reassigns and withdraws active reviewer assignments", async () => {
    const fixture = await createFixture();
    const submissionIds = [fixture.firstSubmissionId, fixture.secondSubmissionId];
    await repository.assign({
      eventId: fixture.eventId,
      roundId: fixture.openRoundId,
      reviewerId: fixture.sourceReviewerId,
      submissionIds,
    });

    assert.equal(
      await repository.reassign({
        eventId: fixture.eventId,
        roundId: fixture.openRoundId,
        fromReviewerId: fixture.sourceReviewerId,
        reviewerId: fixture.targetReviewerId,
        submissionIds,
      }),
      2,
    );
    const reassigned = await client.evaluationAssignment.findMany({
      where: { roundId: fixture.openRoundId },
      orderBy: [{ reviewerId: "asc" }, { submissionId: "asc" }],
    });
    assert.equal(reassigned.filter(({ status }) => status === EvaluationAssignmentStatus.REVOKED).length, 2);
    assert.equal(reassigned.filter(({ status }) => status === EvaluationAssignmentStatus.ASSIGNED).length, 2);

    assert.equal(
      await repository.withdraw({
        eventId: fixture.eventId,
        roundId: fixture.openRoundId,
        reviewerId: fixture.targetReviewerId,
        submissionIds,
      }),
      2,
    );
    const active = await client.evaluationAssignment.count({
      where: { roundId: fixture.openRoundId, status: EvaluationAssignmentStatus.ASSIGNED },
    });
    assert.equal(active, 0);
  });

  test("rejects ineligible submissions, reviewers outside the event, inactive reviewers, and non-open rounds", async () => {
    const fixture = await createFixture();
    const common = {
      eventId: fixture.eventId,
      roundId: fixture.openRoundId,
      reviewerId: fixture.sourceReviewerId,
    };

    await assert.rejects(repository.assign({ ...common, submissionIds: [fixture.draftSubmissionId] }), /eligible/);
    await assert.rejects(repository.assign({ ...common, submissionIds: [fixture.otherSubmissionId] }), /eligible/);
    await assert.rejects(
      repository.assign({ ...common, reviewerId: fixture.otherReviewerId, submissionIds: [fixture.firstSubmissionId] }),
      /active reviewer from this event/,
    );
    await assert.rejects(
      repository.assign({
        ...common,
        reviewerId: fixture.inactiveReviewerId,
        submissionIds: [fixture.firstSubmissionId],
      }),
      /active reviewer from this event/,
    );
    await assert.rejects(
      repository.assign({
        ...common,
        roundId: fixture.plannedRoundId,
        submissionIds: [fixture.firstSubmissionId],
      }),
      /open round/,
    );
  });

  test("lists the selected event round, eligible submissions, assignments, and the no-reviewer state", async () => {
    const fixture = await createFixture();
    await repository.assign({
      eventId: fixture.eventId,
      roundId: fixture.openRoundId,
      reviewerId: fixture.sourceReviewerId,
      submissionIds: [fixture.firstSubmissionId],
    });
    const populated = await repository.getWorkspace(fixture.eventId, fixture.openRoundId);
    assert.equal(populated.rounds.length, 1);
    assert.equal(populated.submissions.length, 2);
    assert.equal(populated.submissions.find(({ id }) => id === fixture.firstSubmissionId)?.assignments.length, 1);
    assert.equal(populated.reviewers.length, 2);

    await client.evaluationReviewer.updateMany({
      where: { eventId: fixture.eventId },
      data: { status: EvaluationReviewerStatus.INACTIVE },
    });
    const noReviewers = await repository.getWorkspace(fixture.eventId, fixture.openRoundId);
    assert.deepEqual(noReviewers.reviewers, []);
    await assert.rejects(
      repository.getWorkspace(fixture.otherEventId, fixture.openRoundId),
      /selected open evaluation round/,
    );
  });
});
