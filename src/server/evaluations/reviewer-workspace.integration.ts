import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationRecommendation,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  EvaluationStatus,
  EventType,
  PrismaClient,
  ReviewerVisibility,
} from "../../generated/prisma/client.ts";
import { EvaluationAssignmentRepository } from "./assignments.ts";
import { ReviewerWorkspaceRepository } from "./reviewer-workspace.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for reviewer workspace integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const repository = new ReviewerWorkspaceRepository(client);
const assignmentRepository = new EvaluationAssignmentRepository(client);

const definitionSnapshot = {
  version: 1,
  title: "Reviewer CFP",
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

interface Fixture {
  readonly eventId: string;
  readonly identityId: string;
  readonly otherIdentityId: string;
  readonly reviewerId: string;
  readonly identifiedAssignmentId: string;
  readonly blindAssignmentId: string;
  readonly anonymizedAssignmentId: string;
  readonly otherAssignmentId: string;
  readonly revokedAssignmentId: string;
  readonly blindRoundId: string;
  readonly identifiedCriterionId: string;
}

async function createFixture(): Promise<Fixture> {
  const event = await client.event.create({
    data: {
      name: "Reviewer Summit",
      slug: "reviewer-summit",
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-04-01T16:00:00.000Z"),
      endsAt: new Date("2027-04-03T00:00:00.000Z"),
      cfpForms: {
        create: {
          key: "reviewer-cfp",
          versions: { create: { versionNumber: 1, schemaVersion: 1, title: "Reviewer CFP", customTypes: [] } },
        },
      },
    },
    include: { cfpForms: { include: { versions: true } } },
  });
  const formVersion = event.cfpForms[0]?.versions[0];
  assert.ok(formVersion);

  const speaker = await client.speaker.create({
    data: {
      eventId: event.id,
      normalizedEmail: "ada@example.test",
      profileVersions: {
        create: {
          versionNumber: 1,
          email: "ada@example.test",
          givenName: "Ada",
          familyName: "Applicant",
          preferredName: "Ada",
        },
      },
    },
  });

  const submissions = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      client.cfpSubmission.create({
        data: {
          eventId: event.id,
          formVersionId: formVersion.id,
          kind: CfpSubmissionKind.ABSTRACT,
          status: CfpSubmissionStatus.UNDER_REVIEW,
          submittedAt: new Date(`2027-02-0${index + 1}T18:00:00.000Z`),
          reviewStartedAt: new Date("2027-02-06T18:00:00.000Z"),
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
                  { questionId: "abstract", sortOrder: 1, value: `Proposal ${index + 1}` },
                ],
              },
            },
          },
        },
      }),
    ),
  );

  const plan = await client.evaluationPlan.create({
    data: {
      eventId: event.id,
      key: "review-plan",
      versions: {
        create: {
          versionNumber: 1,
          title: "Program review",
          status: EvaluationPlanVersionStatus.DRAFT,
        },
      },
    },
    include: { versions: true },
  });
  const planVersion = plan.versions[0];
  assert.ok(planVersion);

  const rounds = await Promise.all(
    [ReviewerVisibility.IDENTIFIED, ReviewerVisibility.BLIND, ReviewerVisibility.ANONYMIZED].map((visibility, index) =>
      client.evaluationRound.create({
        data: {
          planVersionId: planVersion.id,
          key: visibility.toLowerCase(),
          title: `${visibility} round`,
          sortOrder: index,
          status: EvaluationRoundStatus.OPEN,
          reviewerVisibility: visibility,
          visibilitySnapshot: visibility,
          opensAt: new Date("2027-02-01T18:00:00.000Z"),
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
        include: { criteria: true },
      }),
    ),
  );
  const identifiedRound = rounds[0];
  const blindRound = rounds[1];
  const anonymizedRound = rounds[2];
  assert.ok(identifiedRound && blindRound && anonymizedRound);
  const identifiedCriterion = identifiedRound.criteria[0];
  assert.ok(identifiedCriterion);
  await client.evaluationPlanVersion.update({
    where: { id: planVersion.id },
    data: { status: EvaluationPlanVersionStatus.ACTIVE, activatedAt: new Date("2027-02-01T18:00:00.000Z") },
  });

  const [reviewer, otherReviewer] = await Promise.all([
    client.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: "authenticated-reviewer",
        email: "reviewer@example.test",
        displayName: "Riley Reviewer",
      },
    }),
    client.evaluationReviewer.create({
      data: {
        eventId: event.id,
        identityId: "other-reviewer",
        email: "other@example.test",
        displayName: "Other Reviewer",
      },
    }),
  ]);
  const committee = await client.evaluationCommittee.create({
    data: {
      eventId: event.id,
      key: "program-committee",
      name: "Program committee",
      members: { create: { reviewerId: reviewer.id } },
    },
  });

  const [identifiedSubmission, blindSubmission, anonymizedSubmission, otherSubmission, revokedSubmission] = submissions;
  assert.ok(identifiedSubmission && blindSubmission && anonymizedSubmission && otherSubmission && revokedSubmission);

  const [identified, blind, anonymized, other, revoked] = await Promise.all([
    client.evaluationAssignment.create({
      data: { roundId: identifiedRound.id, submissionId: identifiedSubmission.id, reviewerId: reviewer.id },
    }),
    client.evaluationAssignment.create({
      data: {
        roundId: blindRound.id,
        submissionId: blindSubmission.id,
        reviewerId: reviewer.id,
        committeeId: committee.id,
      },
    }),
    client.evaluationAssignment.create({
      data: { roundId: anonymizedRound.id, submissionId: anonymizedSubmission.id, reviewerId: reviewer.id },
    }),
    client.evaluationAssignment.create({
      data: { roundId: blindRound.id, submissionId: otherSubmission.id, reviewerId: otherReviewer.id },
    }),
    client.evaluationAssignment.create({
      data: {
        roundId: blindRound.id,
        submissionId: revokedSubmission.id,
        reviewerId: reviewer.id,
        status: EvaluationAssignmentStatus.REVOKED,
        revokedAt: new Date("2027-02-10T18:00:00.000Z"),
      },
    }),
  ]);

  return {
    eventId: event.id,
    identityId: reviewer.identityId,
    otherIdentityId: otherReviewer.identityId,
    reviewerId: reviewer.id,
    identifiedAssignmentId: identified.id,
    blindAssignmentId: blind.id,
    anonymizedAssignmentId: anonymized.id,
    otherAssignmentId: other.id,
    revokedAssignmentId: revoked.id,
    blindRoundId: blindRound.id,
    identifiedCriterionId: identifiedCriterion.id,
  };
}

describe("reviewer workspace authorization", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("lists only the authenticated reviewer's active-round assignments, including committee work", async () => {
    const fixture = await createFixture();
    const assignments = await repository.list(fixture.identityId);

    assert.deepEqual(
      assignments.map(({ id }) => id).sort(),
      [fixture.identifiedAssignmentId, fixture.blindAssignmentId, fixture.anonymizedAssignmentId].sort(),
    );
    assert.ok(!assignments.some(({ id }) => id === fixture.otherAssignmentId || id === fixture.revokedAssignmentId));

    await client.evaluationReviewer.update({
      where: { id: fixture.reviewerId },
      data: { status: EvaluationReviewerStatus.INACTIVE },
    });
    assert.deepEqual(await repository.list(fixture.identityId), []);
  });

  test("masks identity by round view and rejects forged, withdrawn, and closed-round identifiers", async () => {
    const fixture = await createFixture();
    const identified = await repository.get(fixture.identityId, fixture.identifiedAssignmentId);
    const blind = await repository.get(fixture.identityId, fixture.blindAssignmentId);
    const anonymized = await repository.get(fixture.identityId, fixture.anonymizedAssignmentId);

    assert.equal(identified?.submission.applicants[0]?.email, "ada@example.test");
    assert.deepEqual(
      identified?.submission.answers.map(({ questionId }) => questionId),
      ["speaker-name", "abstract"],
    );
    assert.deepEqual(blind?.submission.applicants, []);
    assert.match(blind?.submission.reference ?? "", /^Submission [0-9A-F]{8}$/);
    assert.notEqual(blind?.submission.reference, identified?.submission.reference);
    assert.deepEqual(
      blind?.submission.answers.map(({ questionId }) => questionId),
      ["abstract"],
    );
    assert.match(anonymized?.submission.reference ?? "", /^Submission [0-9A-F]{8}$/);
    assert.deepEqual(anonymized?.submission.applicants, []);
    assert.equal(await repository.get(fixture.identityId, fixture.otherAssignmentId), null);
    assert.equal(await repository.get(fixture.identityId, fixture.revokedAssignmentId), null);

    await client.evaluationRound.update({
      where: { id: fixture.blindRoundId },
      data: {
        status: EvaluationRoundStatus.CLOSED,
        closesAt: new Date("2027-02-20T18:00:00.000Z"),
      },
    });
    assert.equal(await repository.get(fixture.identityId, fixture.blindAssignmentId), null);
  });
});

describe("reviewer workspace evaluation drafts and submission", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("saves a partial draft, reflects it on reload, and blocks finalize until required criteria are scored", async () => {
    const fixture = await createFixture();

    await repository.saveDraft(fixture.identityId, fixture.identifiedAssignmentId, {
      expectedVersion: 0,
      overallNote: "Promising start.",
      recommendation: null,
      criteria: [{ criterionId: fixture.identifiedCriterionId, score: null, note: "Needs more detail." }],
    });

    const reloaded = await repository.get(fixture.identityId, fixture.identifiedAssignmentId);
    assert.equal(reloaded?.evaluation.status, EvaluationStatus.DRAFT);
    assert.equal(reloaded?.evaluation.version, 1);
    assert.equal(reloaded?.evaluation.overallNote, "Promising start.");
    assert.equal(reloaded?.criteria[0]?.score, null);
    assert.equal(reloaded?.criteria[0]?.note, "Needs more detail.");

    await assert.rejects(
      repository.submitFinal(fixture.identityId, fixture.identifiedAssignmentId, {
        expectedVersion: 1,
        overallNote: "Promising start.",
        recommendation: EvaluationRecommendation.ACCEPT,
        criteria: [],
      }),
      /must have a score before submitting/,
    );
  });

  test("rejects out-of-range scores server-side", async () => {
    const fixture = await createFixture();
    await assert.rejects(
      repository.saveDraft(fixture.identityId, fixture.identifiedAssignmentId, {
        expectedVersion: 0,
        overallNote: null,
        recommendation: null,
        criteria: [{ criterionId: fixture.identifiedCriterionId, score: 9, note: null }],
      }),
      /must be between/,
    );
  });

  test("rejects a stale concurrent edit by version and finalizes once resolved", async () => {
    const fixture = await createFixture();
    await repository.saveDraft(fixture.identityId, fixture.identifiedAssignmentId, {
      expectedVersion: 0,
      overallNote: "First pass",
      recommendation: null,
      criteria: [{ criterionId: fixture.identifiedCriterionId, score: 3, note: null }],
    });

    await assert.rejects(
      repository.saveDraft(fixture.identityId, fixture.identifiedAssignmentId, {
        expectedVersion: 0,
        overallNote: "Stale concurrent edit",
        recommendation: null,
        criteria: [{ criterionId: fixture.identifiedCriterionId, score: 4, note: null }],
      }),
      /changed since you loaded it/,
    );

    await repository.submitFinal(fixture.identityId, fixture.identifiedAssignmentId, {
      expectedVersion: 1,
      overallNote: "Final feedback",
      recommendation: EvaluationRecommendation.ACCEPT,
      criteria: [{ criterionId: fixture.identifiedCriterionId, score: 4, note: "Solid" }],
    });

    const finalized = await repository.get(fixture.identityId, fixture.identifiedAssignmentId);
    assert.equal(finalized?.evaluation.status, EvaluationStatus.FINAL);
    assert.equal(finalized?.evaluation.recommendation, EvaluationRecommendation.ACCEPT);
  });

  test("finalized evaluations are immutable to the reviewer until an admin reopens them, then support replay", async () => {
    const fixture = await createFixture();
    await repository.submitFinal(fixture.identityId, fixture.identifiedAssignmentId, {
      expectedVersion: 0,
      overallNote: "Final feedback",
      recommendation: EvaluationRecommendation.ACCEPT,
      criteria: [{ criterionId: fixture.identifiedCriterionId, score: 5, note: "Excellent" }],
    });

    await assert.rejects(
      repository.saveDraft(fixture.identityId, fixture.identifiedAssignmentId, {
        expectedVersion: 1,
        overallNote: "Trying to edit after finalize",
        recommendation: null,
        criteria: [],
      }),
      /finalized and cannot be edited/,
    );

    await assignmentRepository.reopenEvaluation(fixture.eventId, fixture.identifiedAssignmentId);

    const reopened = await repository.get(fixture.identityId, fixture.identifiedAssignmentId);
    assert.equal(reopened?.evaluation.status, EvaluationStatus.DRAFT);
    assert.equal(reopened?.evaluation.version, 2);

    await repository.saveDraft(fixture.identityId, fixture.identifiedAssignmentId, {
      expectedVersion: 2,
      overallNote: "Replay after reopen",
      recommendation: null,
      criteria: [{ criterionId: fixture.identifiedCriterionId, score: 4, note: null }],
    });
    const replayed = await repository.get(fixture.identityId, fixture.identifiedAssignmentId);
    assert.equal(replayed?.evaluation.overallNote, "Replay after reopen");
  });
});
