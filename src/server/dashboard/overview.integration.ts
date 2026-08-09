import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionStatus,
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationRoundStatus,
  EventType,
  PrismaClient,
  ReviewerVisibility,
} from "../../generated/prisma/client.ts";
import { AgendaPlacementRepository } from "../agenda/placements.ts";
import { EventRepository, RoomRepository } from "../events/repositories.ts";
import { ProgramSessionRepository } from "../sessions/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { EventOverviewRepository } from "./overview.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for event overview integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const now = new Date("2027-03-14T08:30:00.000Z");
const repository = new EventOverviewRepository(client, () => now);
const events = new EventRepository(client);
const rooms = new RoomRepository(client);
const speakers = new SpeakerRepository(client);
const sessions = new ProgramSessionRepository(client);
const placements = new AgendaPlacementRepository(client);

async function createEvent(slug: string, timezone = "America/Los_Angeles") {
  return events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone,
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
  });
}

async function createSubmission(
  eventId: string,
  status: CfpSubmissionStatus,
  submittedAt: Date | null,
  speakerIds: readonly string[],
) {
  const form = await client.cfpForm.create({
    data: {
      eventId,
      key: `form-${crypto.randomUUID()}`,
      versions: { create: { versionNumber: 1, schemaVersion: 1, title: "Board Game Design CFP", customTypes: {} } },
    },
    include: { versions: true },
  });
  const formVersion = form.versions[0];
  assert.ok(formVersion);
  const reviewStartedAt = status === CfpSubmissionStatus.DRAFT || status === CfpSubmissionStatus.SUBMITTED ? null : now;
  const decidedAt =
    status === CfpSubmissionStatus.WAITLISTED ||
    status === CfpSubmissionStatus.ACCEPTED ||
    status === CfpSubmissionStatus.REJECTED ||
    status === CfpSubmissionStatus.CONFIRMED
      ? now
      : null;
  const confirmedAt = status === CfpSubmissionStatus.CONFIRMED ? now : null;
  return client.cfpSubmission.create({
    data: {
      eventId,
      formVersionId: formVersion.id,
      kind: CfpSubmissionKind.ABSTRACT,
      status,
      submittedAt,
      reviewStartedAt,
      decidedAt,
      confirmedAt,
      participants: { create: speakerIds.map((speakerId, sortOrder) => ({ speakerId, sortOrder })) },
    },
  });
}

async function createEvaluationAssignment(
  eventId: string,
  submissionId: string,
  status: EvaluationAssignmentStatus,
  reviewerEmail: string,
  revoked = false,
) {
  const plan = await client.evaluationPlan.create({
    data: {
      eventId,
      key: `plan-${crypto.randomUUID()}`,
      versions: {
        create: {
          versionNumber: 1,
          title: "Evaluation plan",
          status: EvaluationPlanVersionStatus.ACTIVE,
          activatedAt: now,
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
      key: "screening",
      title: "Screening",
      sortOrder: 0,
      status: EvaluationRoundStatus.OPEN,
      visibilitySnapshot: ReviewerVisibility.BLIND,
      opensAt: now,
    },
  });
  const reviewer = await client.evaluationReviewer.create({
    data: { eventId, identityId: reviewerEmail, email: reviewerEmail, displayName: reviewerEmail },
  });
  return client.evaluationAssignment.create({
    data: {
      roundId: round.id,
      submissionId,
      reviewerId: reviewer.id,
      status,
      revokedAt: revoked ? now : null,
      completedAt: status === EvaluationAssignmentStatus.COMPLETED ? now : null,
    },
  });
}

describe("event overview metrics", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("returns zeroed metrics and empty lists for an event with no data", async () => {
    const event = await createEvent("empty-overview");

    const metrics = await repository.get(event.id, event.timezone);

    assert.equal(metrics.submissions.total, 0);
    assert.equal(metrics.submissions.submittedLast7Days, 0);
    assert.deepEqual(metrics.submissions.recent, []);
    assert.equal(
      Object.values(metrics.submissions.byStatus).every((count) => count === 0),
      true,
    );
    assert.equal(metrics.participants.total, 0);
    assert.deepEqual(metrics.participants.missingBiography, []);
    assert.deepEqual(metrics.participants.missingHeadshot, []);
    assert.deepEqual(metrics.speakerTasks.counts, {
      outstanding: 0,
      overdue: 0,
      complete: 0,
      withdrawn: 0,
      "not-applicable": 0,
    });
    assert.equal(metrics.evaluations.totalAssignments, 0);
    assert.equal(metrics.evaluations.completedAssignments, 0);
    assert.deepEqual(metrics.sessions.unscheduled, []);
  });

  test("aggregates status transitions, deduplicated participants, evaluation completion, and scheduling from authoritative event-scoped data", async () => {
    const event = await createEvent("representative-overview");
    const otherEvent = await createEvent("other-overview");

    const ada = await speakers.create({
      eventId: event.id,
      email: "ada@example.test",
      givenName: "Ada",
      familyName: "Lovelace",
      biography: "Mathematician and writer.",
      photoObjectKey: "ada.jpg",
    });
    const grace = await speakers.create({
      eventId: event.id,
      email: "grace@example.test",
      givenName: "Grace",
      familyName: "Hopper",
    });
    await speakers.create({
      eventId: otherEvent.id,
      email: "other@example.test",
      givenName: "Other",
      familyName: "Speaker",
    });

    await createSubmission(event.id, CfpSubmissionStatus.DRAFT, null, []);
    const submitted = await createSubmission(
      event.id,
      CfpSubmissionStatus.SUBMITTED,
      new Date("2027-03-12T10:00:00.000Z"),
      [ada.id],
    );
    const accepted = await createSubmission(
      event.id,
      CfpSubmissionStatus.ACCEPTED,
      new Date("2027-03-13T10:00:00.000Z"),
      [ada.id, grace.id],
    );
    await createSubmission(otherEvent.id, CfpSubmissionStatus.SUBMITTED, now, []);

    await createEvaluationAssignment(
      event.id,
      submitted.id,
      EvaluationAssignmentStatus.COMPLETED,
      "reviewer-a@example.test",
    );
    await createEvaluationAssignment(
      event.id,
      accepted.id,
      EvaluationAssignmentStatus.ASSIGNED,
      "reviewer-b@example.test",
    );
    await createEvaluationAssignment(
      event.id,
      accepted.id,
      EvaluationAssignmentStatus.REVOKED,
      "reviewer-c@example.test",
      true,
    );

    const room = await rooms.create({ eventId: event.id, name: "Main hall" });
    const scheduledSession = await sessions.createManual({
      eventId: event.id,
      title: "Scheduled talk",
      durationMinutes: 45,
    });
    await placements.place({
      eventId: event.id,
      sessionId: scheduledSession.id,
      startsAt: new Date("2027-05-10T17:00:00.000Z"),
      durationMinutes: 45,
      roomId: room.id,
    });
    const unscheduledSession = await sessions.createManual({
      eventId: event.id,
      title: "Unscheduled talk",
      durationMinutes: 30,
    });
    await sessions.createManual({ eventId: otherEvent.id, title: "Other event talk", durationMinutes: 30 });

    const metrics = await repository.get(event.id, event.timezone);

    assert.equal(metrics.submissions.total, 3);
    assert.equal(metrics.submissions.submittedLast7Days, 2);
    assert.equal(metrics.submissions.byStatus.DRAFT, 1);
    assert.equal(metrics.submissions.byStatus.SUBMITTED, 1);
    assert.equal(metrics.submissions.byStatus.ACCEPTED, 1);
    assert.deepEqual(
      metrics.submissions.recent.map(({ id, status }) => [id, status]),
      [
        [accepted.id, CfpSubmissionStatus.ACCEPTED],
        [submitted.id, CfpSubmissionStatus.SUBMITTED],
      ],
    );
    assert.deepEqual(metrics.submissions.recent[0]?.applicantNames, ["Ada Lovelace", "Grace Hopper"]);

    assert.equal(metrics.participants.total, 2);
    assert.deepEqual(
      metrics.participants.missingBiography.map(({ id }) => id),
      [grace.id],
    );
    assert.deepEqual(
      metrics.participants.missingHeadshot.map(({ id }) => id),
      [grace.id],
    );

    assert.equal(metrics.evaluations.totalAssignments, 2);
    assert.equal(metrics.evaluations.completedAssignments, 1);

    assert.deepEqual(
      metrics.sessions.unscheduled.map(({ id }) => id),
      [unscheduledSession.id],
    );
  });

  test("counts a promoted session as unscheduled only while its source submission is still accepted", async () => {
    const event = await createEvent("promoted-overview");
    const accepted = await createSubmission(event.id, CfpSubmissionStatus.ACCEPTED, now, []);
    const rejected = await createSubmission(event.id, CfpSubmissionStatus.REJECTED, now, []);
    const acceptedSession = await sessions.promote({
      eventId: event.id,
      sourceSubmissionId: accepted.id,
      title: "Promoted accepted talk",
      durationMinutes: 30,
    });
    await sessions.promote({
      eventId: event.id,
      sourceSubmissionId: rejected.id,
      title: "Promoted rejected talk",
      durationMinutes: 30,
    });

    const metrics = await repository.get(event.id, event.timezone);

    assert.deepEqual(
      metrics.sessions.unscheduled.map(({ id }) => id),
      [acceptedSession.id],
    );
  });

  test("labels speaker task overdue state using the event's own time zone", async () => {
    const event = await createEvent("timezone-overview", "America/Los_Angeles");
    const speaker = await speakers.create({
      eventId: event.id,
      email: "reviewer@example.test",
      givenName: "Grace",
      familyName: "Hopper",
    });
    const submission = await createSubmission(event.id, CfpSubmissionStatus.CONFIRMED, now, [speaker.id]);
    assert.ok(submission);
    const definition = await client.speakerTaskDefinition.create({
      data: {
        eventId: event.id,
        key: "agreement",
        versions: {
          create: {
            versionNumber: 1,
            sortOrder: 0,
            title: "Sign agreement",
            applicability: {},
          },
        },
      },
      include: { versions: true },
    });
    const definitionVersion = definition.versions[0];
    assert.ok(definitionVersion);
    // 2027-03-14T07:59:59Z is still 2027-03-13 in America/Los_Angeles (UTC-8), a day before `now`'s local date.
    await client.speakerTaskAssignment.create({
      data: {
        eventId: event.id,
        definitionId: definition.id,
        definitionVersionId: definitionVersion.id,
        speakerId: speaker.id,
        status: "PENDING",
        assignedAt: new Date("2027-03-10T08:00:00.000Z"),
        dueAt: new Date("2027-03-14T07:59:59.000Z"),
      },
    });

    const metrics = await repository.get(event.id, event.timezone);

    assert.equal(metrics.speakerTasks.counts.overdue, 1);
    assert.equal(metrics.speakerTasks.counts.outstanding, 0);
  });
});
