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
import { RepositoryError } from "../events/repositories.ts";
import { EvaluationAssignmentRepository } from "./assignments.ts";
import { EvaluationProgressionRepository } from "./progression.ts";
import { EvaluationPlanRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for evaluation progression integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const assignments = new EvaluationAssignmentRepository(client);
const plans = new EvaluationPlanRepository(client);
const progression = new EvaluationProgressionRepository(client);

async function expectRepositoryError(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError);
}

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: `Progression ${slug}`,
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-15T00:00:00.000Z"),
      cfpForms: {
        create: {
          key: "main-cfp",
          versions: { create: { versionNumber: 1, schemaVersion: 1, title: "Main CFP", customTypes: [] } },
        },
      },
    },
    include: { cfpForms: { include: { versions: true } } },
  });
}

describe("evaluation round progression", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("audits correction returns, advances completed submissions, and closes a round idempotently", async () => {
    const [event, otherEvent] = await Promise.all([createEvent("main"), createEvent("other")]);
    const formVersion = event.cfpForms[0]?.versions[0];
    assert.ok(formVersion);
    const submissions = await Promise.all(
      [CfpSubmissionStatus.SUBMITTED, CfpSubmissionStatus.UNDER_REVIEW, CfpSubmissionStatus.SUBMITTED].map(
        (status, index) =>
          client.cfpSubmission.create({
            data: {
              eventId: event.id,
              formVersionId: formVersion.id,
              kind: CfpSubmissionKind.ABSTRACT,
              status,
              submittedAt: new Date(`2027-01-${10 + index}T18:00:00.000Z`),
              reviewStartedAt:
                status === CfpSubmissionStatus.UNDER_REVIEW ? new Date("2027-01-15T18:00:00.000Z") : null,
            },
          }),
      ),
    );
    const [advancedSubmission, correctedSubmission, incompleteSubmission] = submissions;
    assert.ok(advancedSubmission);
    assert.ok(correctedSubmission);
    assert.ok(incompleteSubmission);

    const plan = await client.evaluationPlan.create({
      data: {
        eventId: event.id,
        key: "main-evaluation",
        versions: {
          create: {
            versionNumber: 1,
            title: "Main evaluation",
            status: EvaluationPlanVersionStatus.ACTIVE,
            activatedAt: new Date("2027-01-01T18:00:00.000Z"),
          },
        },
      },
      include: { versions: true },
    });
    const planVersion = plan.versions[0];
    assert.ok(planVersion);
    const [firstRound, secondRound] = await Promise.all([
      client.evaluationRound.create({
        data: {
          planVersionId: planVersion.id,
          key: "screening",
          title: "Screening",
          sortOrder: 0,
          status: EvaluationRoundStatus.OPEN,
          reviewerVisibility: ReviewerVisibility.BLIND,
          visibilitySnapshot: ReviewerVisibility.BLIND,
          opensAt: new Date("2026-01-15T18:00:00.000Z"),
        },
      }),
      client.evaluationRound.create({
        data: {
          planVersionId: planVersion.id,
          key: "committee",
          title: "Committee",
          sortOrder: 1,
          status: EvaluationRoundStatus.PLANNED,
          reviewerVisibility: ReviewerVisibility.IDENTIFIED,
        },
      }),
    ]);
    const reviewer = await client.evaluationReviewer.create({
      data: { eventId: event.id, identityId: "reviewer", email: "reviewer@example.test", displayName: "Reviewer" },
    });
    const completedAt = new Date("2027-01-20T18:00:00.000Z");
    const [advancedAssignment, correctedAssignment, incompleteAssignment] = await Promise.all(
      submissions.map((submission, index) =>
        client.evaluationAssignment.create({
          data: {
            roundId: firstRound.id,
            submissionId: submission.id,
            reviewerId: reviewer.id,
            status: index === 2 ? EvaluationAssignmentStatus.ASSIGNED : EvaluationAssignmentStatus.COMPLETED,
            completedAt: index === 2 ? null : completedAt,
            evaluation:
              index === 2
                ? undefined
                : { create: { status: EvaluationStatus.FINAL, submittedAt: completedAt, version: 1 } },
          },
        }),
      ),
    );
    assert.ok(advancedAssignment);
    assert.ok(correctedAssignment);
    assert.ok(incompleteAssignment);

    await Promise.all([
      assignments.reopenEvaluation(event.id, correctedAssignment.id, {
        actorId: "admin-1",
        expectedEvaluationVersion: 1,
      }),
      assignments.reopenEvaluation(event.id, correctedAssignment.id, {
        actorId: "admin-1",
        expectedEvaluationVersion: 1,
      }),
    ]);
    const returned = await client.evaluation.findUniqueOrThrow({ where: { assignmentId: correctedAssignment.id } });
    assert.equal(returned.status, EvaluationStatus.DRAFT);
    assert.equal(returned.version, 2);
    assert.equal(await client.evaluationCorrectionReturn.count({ where: { assignmentId: correctedAssignment.id } }), 1);
    await client.$transaction([
      client.evaluation.update({
        where: { id: returned.id },
        data: { status: EvaluationStatus.FINAL, submittedAt: completedAt },
      }),
      client.evaluationAssignment.update({
        where: { id: correctedAssignment.id },
        data: { status: EvaluationAssignmentStatus.COMPLETED, completedAt },
      }),
    ]);
    await expectRepositoryError(
      assignments.reopenEvaluation(event.id, correctedAssignment.id, {
        actorId: "admin-1",
        expectedEvaluationVersion: 1,
      }),
    );

    await Promise.all([
      progression.advance({
        eventId: event.id,
        roundId: firstRound.id,
        submissionId: advancedSubmission.id,
        actorId: "admin-1",
      }),
      progression.advance({
        eventId: event.id,
        roundId: firstRound.id,
        submissionId: advancedSubmission.id,
        actorId: "admin-1",
      }),
    ]);
    assert.equal(
      await client.evaluationRoundAdvancement.count({
        where: { sourceRoundId: firstRound.id, submissionId: advancedSubmission.id },
      }),
      1,
    );
    await expectRepositoryError(
      assignments.reopenEvaluation(event.id, advancedAssignment.id, {
        actorId: "admin-1",
        expectedEvaluationVersion: 1,
      }),
    );
    await expectRepositoryError(
      progression.advance({
        eventId: otherEvent.id,
        roundId: firstRound.id,
        submissionId: advancedSubmission.id,
        actorId: "admin-2",
      }),
    );

    await expectRepositoryError(
      plans.transition(event.id, firstRound.id, EvaluationRoundStatus.CLOSED, { actorId: "admin-1" }),
    );
    await client.evaluationAssignment.update({
      where: { id: incompleteAssignment.id },
      data: { status: EvaluationAssignmentStatus.REVOKED, revokedAt: completedAt },
    });
    await plans.transition(event.id, firstRound.id, EvaluationRoundStatus.CLOSED, { actorId: "admin-1" });
    await plans.transition(event.id, firstRound.id, EvaluationRoundStatus.CLOSED, { actorId: "admin-1" });
    const closeTransitions = await client.evaluationRoundTransition.findMany({
      where: { roundId: firstRound.id, toStatus: EvaluationRoundStatus.CLOSED },
    });
    assert.equal(closeTransitions.length, 1);
    assert.equal(closeTransitions[0]?.actorId, "admin-1");

    await plans.transition(event.id, secondRound.id, EvaluationRoundStatus.OPEN, { actorId: "admin-1" });
    const nextWorkspace = await assignments.getWorkspace(event.id, secondRound.id);
    assert.deepEqual(
      nextWorkspace.submissions.map(({ id }) => id),
      [advancedSubmission.id],
    );
    await assignments.assign({
      eventId: event.id,
      roundId: secondRound.id,
      submissionIds: [advancedSubmission.id],
      reviewerId: reviewer.id,
    });
    const preserved = await client.evaluationAssignment.findUniqueOrThrow({
      where: { id: advancedAssignment.id },
      include: { evaluation: true },
    });
    assert.equal(preserved.status, EvaluationAssignmentStatus.COMPLETED);
    assert.equal(preserved.evaluation?.status, EvaluationStatus.FINAL);
    assert.equal(await client.evaluationAssignment.count({ where: { submissionId: advancedSubmission.id } }), 2);
  });
});
