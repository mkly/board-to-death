import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionStatus,
  EventType,
  PrismaClient,
  SpeakerTaskAssignmentStatus,
} from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { SpeakerOnboardingRepository } from "./onboarding.ts";
import { SpeakerRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for speaker onboarding integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const speakers = new SpeakerRepository(client);
let currentTime = new Date("2027-01-01T12:00:00.000Z");
const onboarding = new SpeakerOnboardingRepository(client, () => new Date(currentTime));

async function createEvent(slug: string): Promise<string> {
  const event = await events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-03-13T17:00:00.000Z"),
    endsAt: new Date("2027-03-15T00:00:00.000Z"),
  });
  return event.id;
}

async function createSpeaker(eventId: string, email = "speaker@example.test") {
  return speakers.create({ eventId, email, givenName: "Board", familyName: "Speaker" });
}

async function createDefinition(eventId: string, key = "headshot", sortOrder = 0) {
  return onboarding.createDefinition({
    eventId,
    key,
    sortOrder,
    title: "Upload a headshot",
    description: "A square image works best.",
    applicability: { sessionKinds: ["TALK"], confirmedOnly: true },
    defaultDueOffsetDays: 5,
    responseRequired: true,
    responseSchema: { type: "object", required: ["objectKey"] },
  });
}

async function addEligibleSubmission(
  eventId: string,
  speakerId: string,
  status: Extract<CfpSubmissionStatus, "ACCEPTED" | "CONFIRMED"> = CfpSubmissionStatus.ACCEPTED,
) {
  const form = await client.cfpForm.create({
    data: {
      eventId,
      key: `form-${speakerId}`,
      versions: {
        create: { versionNumber: 1, schemaVersion: 1, title: "Speaker form", customTypes: {} },
      },
    },
    include: { versions: true },
  });
  const formVersion = form.versions[0];
  assert.ok(formVersion);
  return client.cfpSubmission.create({
    data: {
      eventId,
      formVersionId: formVersion.id,
      kind: "ABSTRACT",
      status,
      submittedAt: currentTime,
      reviewStartedAt: currentTime,
      decidedAt: currentTime,
      confirmedAt: status === CfpSubmissionStatus.CONFIRMED ? currentTime : null,
      participants: { create: { speakerId, sortOrder: 0 } },
    },
  });
}

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

describe("speaker onboarding persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    currentTime = new Date("2027-01-01T12:00:00.000Z");
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("versions definitions while preserving order, applicability, due rules, and response requirements", async () => {
    const eventId = await createEvent("definition-versions");
    const biography = await createDefinition(eventId, "biography", 1);
    const headshot = await createDefinition(eventId, "headshot", 0);
    const updated = await onboarding.createDefinitionVersion(eventId, biography.id, {
      sortOrder: 2,
      title: "Review your biography",
      applicability: { confirmedOnly: true },
      defaultDueOffsetDays: 10,
      responseRequired: false,
    });

    assert.deepEqual(
      updated.versions.map(({ versionNumber, sortOrder, title }) => [versionNumber, sortOrder, title]),
      [
        [1, 1, "Upload a headshot"],
        [2, 2, "Review your biography"],
      ],
    );
    assert.deepEqual(
      (await onboarding.listDefinitions(eventId)).map(({ id }) => id),
      [headshot.id, biography.id],
    );
    assert.deepEqual(updated.versions[0]?.applicability, { sessionKinds: ["TALK"], confirmedOnly: true });
    assert.deepEqual(updated.versions[0]?.responseSchema, { type: "object", required: ["objectKey"] });
  });

  test("assigns the latest definition version with deterministic due dates and event isolation", async () => {
    const eventId = await createEvent("assignments");
    const otherEventId = await createEvent("other-assignments");
    const speaker = await createSpeaker(eventId);
    await addEligibleSubmission(eventId, speaker.id, CfpSubmissionStatus.CONFIRMED);
    const outsider = await createSpeaker(otherEventId, "outsider@example.test");
    const definition = await createDefinition(eventId);
    const assignment = await onboarding.assign({ eventId, definitionId: definition.id, speakerId: speaker.id });

    assert.equal(assignment.status, SpeakerTaskAssignmentStatus.PENDING);
    assert.deepEqual(assignment.assignedAt, currentTime);
    assert.deepEqual(assignment.dueAt, new Date("2027-01-06T12:00:00.000Z"));
    assert.equal(assignment.definitionVersion.versionNumber, 1);
    assert.deepEqual(
      assignment.transitions.map(({ fromStatus, toStatus }) => [fromStatus, toStatus]),
      [[null, SpeakerTaskAssignmentStatus.PENDING]],
    );
    await expectRepositoryError(
      onboarding.assign({ eventId, definitionId: definition.id, speakerId: speaker.id }),
      "conflict",
    );
    await expectRepositoryError(
      onboarding.assign({ eventId, definitionId: definition.id, speakerId: outsider.id }),
      "not-found",
    );
  });

  test("preserves response attempts through revision and completes only on approval", async () => {
    const eventId = await createEvent("response-history");
    const speaker = await createSpeaker(eventId);
    await addEligibleSubmission(eventId, speaker.id, CfpSubmissionStatus.CONFIRMED);
    const definition = await createDefinition(eventId);
    const assignment = await onboarding.assign({ eventId, definitionId: definition.id, speakerId: speaker.id });

    await expectRepositoryError(onboarding.submit(eventId, assignment.id), "invalid-input");
    currentTime = new Date("2027-01-02T12:00:00.000Z");
    await onboarding.submit(eventId, assignment.id, { objectKey: "headshots/draft.png" });
    currentTime = new Date("2027-01-03T12:00:00.000Z");
    const revision = await onboarding.review(
      eventId,
      assignment.id,
      SpeakerTaskAssignmentStatus.REVISION_REQUESTED,
      "Please use a higher-resolution image.",
    );
    assert.equal(revision.completedAt, null);

    currentTime = new Date("2027-01-04T12:00:00.000Z");
    await onboarding.submit(eventId, assignment.id, { objectKey: "headshots/final.png" });
    currentTime = new Date("2027-01-05T12:00:00.000Z");
    const approved = await onboarding.review(eventId, assignment.id, SpeakerTaskAssignmentStatus.APPROVED);

    assert.equal(approved.status, SpeakerTaskAssignmentStatus.APPROVED);
    assert.deepEqual(approved.completedAt, currentTime);
    assert.deepEqual(
      approved.submissions.map(({ attemptNumber, response }) => [attemptNumber, response]),
      [
        [1, { objectKey: "headshots/draft.png" }],
        [2, { objectKey: "headshots/final.png" }],
      ],
    );
    assert.deepEqual(
      approved.transitions.map(({ toStatus }) => toStatus),
      [
        SpeakerTaskAssignmentStatus.PENDING,
        SpeakerTaskAssignmentStatus.SUBMITTED,
        SpeakerTaskAssignmentStatus.REVISION_REQUESTED,
        SpeakerTaskAssignmentStatus.SUBMITTED,
        SpeakerTaskAssignmentStatus.APPROVED,
      ],
    );
    await expectRepositoryError(onboarding.withdraw(eventId, assignment.id), "invalid-input");
  });

  test("records withdrawal and protects assignment history until the event is deleted", async () => {
    const eventId = await createEvent("withdrawal-deletion");
    const speaker = await createSpeaker(eventId);
    await addEligibleSubmission(eventId, speaker.id, CfpSubmissionStatus.CONFIRMED);
    const definition = await createDefinition(eventId);
    const assignment = await onboarding.assign({ eventId, definitionId: definition.id, speakerId: speaker.id });
    currentTime = new Date("2027-01-02T12:00:00.000Z");
    const withdrawn = await onboarding.withdraw(eventId, assignment.id, "Speaker left the program.");

    assert.equal(withdrawn.status, SpeakerTaskAssignmentStatus.WITHDRAWN);
    assert.deepEqual(withdrawn.withdrawnAt, currentTime);
    await assert.rejects(client.speaker.delete({ where: { id: speaker.id } }));
    await assert.rejects(client.speakerTaskDefinition.delete({ where: { id: definition.id } }));
    await client.event.delete({ where: { id: eventId } });
    assert.equal(await client.speakerTaskAssignment.count({ where: { id: assignment.id } }), 0);
    assert.equal(await client.speakerTaskAssignmentTransition.count({ where: { assignmentId: assignment.id } }), 0);
  });

  test("assigns accepted-speaker cohorts idempotently and rejects ineligible members", async () => {
    const eventId = await createEvent("cohort-assignment");
    const ada = await createSpeaker(eventId, "ada@example.test");
    const grace = await createSpeaker(eventId, "grace@example.test");
    const rejected = await createSpeaker(eventId, "rejected@example.test");
    await addEligibleSubmission(eventId, ada.id, CfpSubmissionStatus.CONFIRMED);
    await addEligibleSubmission(eventId, grace.id, CfpSubmissionStatus.CONFIRMED);
    const definition = await createDefinition(eventId);

    const first = await onboarding.assignCohort({
      eventId,
      definitionId: definition.id,
      speakerIds: [ada.id, grace.id, ada.id],
    });
    assert.equal(first.assignments.length, 2);
    assert.deepEqual(first.skippedActiveSpeakerIds, []);

    const repeated = await onboarding.assignCohort({
      eventId,
      definitionId: definition.id,
      speakerIds: [ada.id, grace.id],
    });
    assert.equal(repeated.assignments.length, 0);
    assert.deepEqual(new Set(repeated.skippedActiveSpeakerIds), new Set([ada.id, grace.id]));
    await expectRepositoryError(
      onboarding.assignCohort({ eventId, definitionId: definition.id, speakerIds: [ada.id, rejected.id] }),
      "invalid-input",
    );
  });

  test("changes due dates only for incomplete assignments and permits reassignment after withdrawal", async () => {
    const eventId = await createEvent("assignment-administration");
    const speaker = await createSpeaker(eventId);
    await addEligibleSubmission(eventId, speaker.id, CfpSubmissionStatus.CONFIRMED);
    const definition = await createDefinition(eventId);
    const assignment = await onboarding.assign({ eventId, definitionId: definition.id, speakerId: speaker.id });
    const changedDueAt = new Date("2027-01-10T12:00:00.000Z");

    const updated = await onboarding.updateDueDate(eventId, assignment.id, changedDueAt);
    assert.deepEqual(updated.dueAt, changedDueAt);
    await expectRepositoryError(
      onboarding.updateDueDate(eventId, assignment.id, new Date("2026-12-31T12:00:00.000Z")),
      "invalid-input",
    );

    await onboarding.withdraw(eventId, assignment.id, "Deadline no longer applies.");
    await expectRepositoryError(onboarding.updateDueDate(eventId, assignment.id, changedDueAt), "invalid-input");
    const reassigned = await onboarding.assign({ eventId, definitionId: definition.id, speakerId: speaker.id });
    assert.notEqual(reassigned.id, assignment.id);
    assert.equal(reassigned.status, SpeakerTaskAssignmentStatus.PENDING);
  });
});
