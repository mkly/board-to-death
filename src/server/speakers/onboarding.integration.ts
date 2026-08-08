import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient, SpeakerTaskAssignmentStatus } from "../../generated/prisma/client.ts";
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

  test("edits, reorders, duplicates, and archives definitions within one event", async () => {
    const eventId = await createEvent("definition-lifecycle");
    const otherEventId = await createEvent("other-definition-lifecycle");
    const biography = await createDefinition(eventId, "biography", 0);
    const headshot = await createDefinition(eventId, "headshot", 1);

    const edited = await onboarding.createDefinitionVersion(eventId, headshot.id, {
      sortOrder: 1,
      title: "Upload a high-resolution headshot",
      description: "Use a square image.",
      applicability: { confirmedOnly: true, sessionKinds: ["TALK"] },
      defaultDueOffsetDays: 7,
      responseRequired: true,
      responseSchema: { type: "object", required: ["objectKey"] },
    });
    assert.equal(edited.versions.at(-1)?.versionNumber, 2);

    const reordered = await onboarding.reorderDefinitions(eventId, [headshot.id, biography.id]);
    assert.deepEqual(
      reordered.map(({ id, versions }) => [id, versions.at(-1)?.sortOrder]),
      [
        [headshot.id, 0],
        [biography.id, 1],
      ],
    );

    const duplicate = await onboarding.duplicateDefinition(eventId, headshot.id, "headshot-copy");
    assert.notEqual(duplicate.id, headshot.id);
    assert.equal(duplicate.versions.at(-1)?.title, "Upload a high-resolution headshot copy");
    assert.equal(await client.speakerTaskAssignment.count({ where: { definitionId: duplicate.id } }), 0);

    const archived = await onboarding.archiveDefinition(eventId, biography.id);
    assert.deepEqual(archived.archivedAt, currentTime);
    assert.deepEqual(
      (await onboarding.listDefinitions(eventId)).map(({ id }) => id),
      [headshot.id, duplicate.id],
    );
    assert.equal((await onboarding.listDefinitions(eventId, { includeArchived: true })).length, 3);

    assert.equal(await onboarding.getDefinition(otherEventId, headshot.id), null);
    await expectRepositoryError(
      onboarding.createDefinitionVersion(otherEventId, headshot.id, {
        sortOrder: 0,
        title: "Cross-event edit",
        applicability: {},
      }),
      "not-found",
    );
    await expectRepositoryError(onboarding.archiveDefinition(otherEventId, headshot.id), "not-found");
  });

  test("preserves a null response schema when reordering and duplicating definitions", async () => {
    const eventId = await createEvent("definition-null-response-schema");
    const noResponse = await onboarding.createDefinition({
      eventId,
      key: "confirm-details",
      sortOrder: 0,
      title: "Confirm your details",
      applicability: { confirmedOnly: true },
      responseRequired: false,
    });
    const headshot = await createDefinition(eventId, "headshot", 1);

    const reordered = await onboarding.reorderDefinitions(eventId, [headshot.id, noResponse.id]);
    const reorderedNoResponse = reordered.find(({ id }) => id === noResponse.id);
    const reorderedVersion = reorderedNoResponse?.versions.at(-1);
    assert.equal(reorderedNoResponse?.versions.at(-1)?.versionNumber, 2);
    assert.equal(reorderedNoResponse?.versions.at(-1)?.sortOrder, 1);
    assert.equal(reorderedNoResponse?.versions.at(-1)?.responseSchema, null);
    const reorderedRows = await client.$queryRaw<Array<{ responseSchemaIsNull: boolean }>>`
      SELECT "responseSchema" IS NULL AS "responseSchemaIsNull"
      FROM "speaker_task_definition_versions"
      WHERE "id" = ${reorderedVersion?.id}
    `;
    assert.equal(reorderedRows[0]?.responseSchemaIsNull, true);

    const duplicate = await onboarding.duplicateDefinition(eventId, noResponse.id, "confirm-details-copy");
    const duplicateVersion = duplicate.versions.at(-1);
    assert.equal(duplicateVersion?.title, "Confirm your details copy");
    assert.equal(duplicateVersion?.responseSchema, null);
    const duplicateRows = await client.$queryRaw<Array<{ responseSchemaIsNull: boolean }>>`
      SELECT "responseSchema" IS NULL AS "responseSchemaIsNull"
      FROM "speaker_task_definition_versions"
      WHERE "id" = ${duplicateVersion?.id}
    `;
    assert.equal(duplicateRows[0]?.responseSchemaIsNull, true);
  });

  test("assigns the latest definition version with deterministic due dates and event isolation", async () => {
    const eventId = await createEvent("assignments");
    const otherEventId = await createEvent("other-assignments");
    const speaker = await createSpeaker(eventId);
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
});
