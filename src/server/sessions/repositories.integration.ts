import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  EventType,
  type Prisma,
  PrismaClient,
  ProgramSessionContentApprovalStatus,
  ProgramSessionKind,
  ProgramSessionParticipantRole,
} from "../../generated/prisma/client.ts";
import type { CfpFormDefinition } from "../../lib/cfp/index.ts";
import { validateAgendaConflicts } from "../agenda/conflicts.ts";
import { CfpFormRepository } from "../cfp/repositories.ts";
import { EventRepository, RepositoryError, TrackRepository } from "../events/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { MAX_SUBSESSIONS_PER_PARENT, ProgramSessionRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for program session repository integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const tracks = new TrackRepository(client);
const forms = new CfpFormRepository(client);
const speakers = new SpeakerRepository(client);
const sessions = new ProgramSessionRepository(client);

const definition: CfpFormDefinition = {
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
};
const definitionSnapshot = JSON.parse(JSON.stringify(definition)) as Prisma.InputJsonValue;

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

async function createSubmission(eventId: string, speakerIds: readonly string[] = []) {
  const form = await forms.create({ eventId, key: "main-cfp", definition });
  const version = await client.cfpFormVersion.findUniqueOrThrow({
    where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
  });
  const category = await client.cfpCategory.create({
    data: { eventId, key: "design", label: "Game design" },
  });
  const submission = await client.cfpSubmission.create({
    data: {
      eventId,
      formVersionId: version.id,
      kind: CfpSubmissionKind.ABSTRACT,
      status: CfpSubmissionStatus.ACCEPTED,
      submittedAt: new Date("2027-01-01T12:00:00.000Z"),
      reviewStartedAt: new Date("2027-01-02T12:00:00.000Z"),
      decidedAt: new Date("2027-01-03T12:00:00.000Z"),
      categories: { create: { categoryId: category.id, sortOrder: 0 } },
      participants: {
        create: speakerIds.map((speakerId, sortOrder) => ({ speakerId, sortOrder })),
      },
      revisions: {
        create: {
          versionNumber: 1,
          kind: CfpSubmissionRevisionKind.FINAL,
          formVersionId: version.id,
          definitionSnapshot,
          answers: {
            create: [
              { questionId: "title", sortOrder: 0, value: "From Abstract to Program" },
              { questionId: "abstract", sortOrder: 1, value: "Copied from the accepted submission." },
            ],
          },
        },
      },
    },
  });
  return { submissionId: submission.id, categoryId: category.id };
}

async function createSpeaker(eventId: string, email: string, givenName: string) {
  return speakers.create({ eventId, email, givenName, familyName: "Speaker" });
}

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

describe("program session persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("creates role-aware participants with immutable versions and keeps legacy speakers compatible", async () => {
    const eventId = await createEvent("versioned-sessions");
    const track = await tracks.create({ eventId, name: "Design", color: "blue" });
    const primary = await createSpeaker(eventId, "primary@example.test", "Primary");
    const coSpeaker = await createSpeaker(eventId, "co@example.test", "Co");

    const manual = await sessions.createManual({
      eventId,
      title: "Designing Together",
      description: "Original description",
      durationMinutes: 45,
      trackId: track.id,
      participants: [
        { speakerId: coSpeaker.id, role: ProgramSessionParticipantRole.MODERATOR },
        { speakerId: primary.id, role: ProgramSessionParticipantRole.SPEAKER },
      ],
    });
    assert.equal(manual.kind, ProgramSessionKind.MANUAL);
    assert.equal(manual.contentApprovalStatus, ProgramSessionContentApprovalStatus.DRAFT);
    assert.deepEqual(manual.version.speakerIds, [coSpeaker.id, primary.id]);
    assert.deepEqual(manual.version.participants, [
      { speakerId: coSpeaker.id, role: ProgramSessionParticipantRole.MODERATOR },
      { speakerId: primary.id, role: ProgramSessionParticipantRole.SPEAKER },
    ]);

    const overlapping = await sessions.createManual({
      eventId,
      title: "Moderated at the same time",
      durationMinutes: 45,
      participants: [{ speakerId: coSpeaker.id, role: ProgramSessionParticipantRole.MODERATOR }],
    });
    const conflicts = validateAgendaConflicts(
      {
        startsAt: new Date("2027-03-13T17:00:00.000Z"),
        endsAt: new Date("2027-03-15T00:00:00.000Z"),
        timezone: "America/Los_Angeles",
      },
      [
        {
          id: manual.id,
          startsAt: new Date("2027-03-13T18:00:00.000Z"),
          endsAt: new Date("2027-03-13T18:45:00.000Z"),
          speakerIds: manual.version.speakerIds,
        },
        {
          id: overlapping.id,
          startsAt: new Date("2027-03-13T18:15:00.000Z"),
          endsAt: new Date("2027-03-13T19:00:00.000Z"),
          speakerIds: overlapping.version.speakerIds,
        },
      ],
    );
    assert.equal(
      conflicts.some(({ type, resourceId }) => type === "speaker" && resourceId === coSpeaker.id),
      true,
    );

    const edited = await sessions.update(eventId, manual.id, {
      contentApprovalStatus: ProgramSessionContentApprovalStatus.APPROVED,
      title: "Designing Better Together",
      durationMinutes: 60,
      participants: [
        { speakerId: primary.id, role: ProgramSessionParticipantRole.CHAIRPERSON },
        { speakerId: coSpeaker.id, role: ProgramSessionParticipantRole.SPEAKER },
      ],
    });
    assert.equal(edited.contentApprovalStatus, ProgramSessionContentApprovalStatus.APPROVED);
    assert.deepEqual(
      edited.versions.map(({ versionNumber, title, durationMinutes, participants }) => ({
        versionNumber,
        title,
        durationMinutes,
        participants,
      })),
      [
        {
          versionNumber: 1,
          title: "Designing Together",
          durationMinutes: 45,
          participants: [
            { speakerId: coSpeaker.id, role: ProgramSessionParticipantRole.MODERATOR },
            { speakerId: primary.id, role: ProgramSessionParticipantRole.SPEAKER },
          ],
        },
        {
          versionNumber: 2,
          title: "Designing Better Together",
          durationMinutes: 60,
          participants: [
            { speakerId: primary.id, role: ProgramSessionParticipantRole.CHAIRPERSON },
            { speakerId: coSpeaker.id, role: ProgramSessionParticipantRole.SPEAKER },
          ],
        },
      ],
    );

    const guaranteed = await sessions.createGuaranteed({
      eventId,
      title: "Publisher Keynote",
      durationMinutes: 30,
      speakerIds: [primary.id],
    });
    assert.equal(guaranteed.kind, ProgramSessionKind.GUARANTEED);
    assert.equal(guaranteed.sourceSubmissionId, null);
    assert.deepEqual(guaranteed.version.participants, [
      { speakerId: primary.id, role: ProgramSessionParticipantRole.SPEAKER },
    ]);
  });

  test("links one promoted session to its source while allowing independent later edits", async () => {
    const eventId = await createEvent("promoted-session");
    const primary = await createSpeaker(eventId, "primary-promoted@example.test", "Primary");
    const coSpeaker = await createSpeaker(eventId, "co-promoted@example.test", "Co");
    const { submissionId: sourceSubmissionId, categoryId } = await createSubmission(eventId, [
      coSpeaker.id,
      primary.id,
    ]);
    const promotedSessions = await Promise.all(
      Array.from({ length: 4 }, () => sessions.promote({ eventId, sourceSubmissionId })),
    );
    const promoted = promotedSessions[0];
    assert.ok(promoted);

    assert.equal(promoted.kind, ProgramSessionKind.PROMOTED);
    assert.equal(promoted.sourceSubmissionId, sourceSubmissionId);
    assert.equal(promoted.version.title, "From Abstract to Program");
    assert.equal(promoted.version.description, "Copied from the accepted submission.");
    assert.equal(promoted.version.categoryId, categoryId);
    assert.deepEqual(promoted.version.speakerIds, [coSpeaker.id, primary.id]);
    assert.deepEqual(
      promotedSessions.map(({ id }) => id),
      Array.from({ length: 4 }, () => promoted.id),
    );
    assert.equal(await client.programSession.count({ where: { sourceSubmissionId } }), 1);

    const edited = await sessions.update(eventId, promoted.id, {
      title: "An Independently Edited Program Title",
      description: "No longer tied to later submission edits.",
    });
    assert.equal(edited.sourceSubmissionId, sourceSubmissionId);
    assert.equal(edited.version.versionNumber, 2);
    assert.equal(edited.version.title, "An Independently Edited Program Title");
    assert.equal(edited.versions[0]?.title, "From Abstract to Program");
  });

  test("archives sessions without deleting their history", async () => {
    const eventId = await createEvent("archived-sessions");
    const session = await sessions.createManual({ eventId, title: "Retired Talk", durationMinutes: 30 });
    const archivedAt = new Date("2027-02-01T12:00:00.000Z");

    const archived = await sessions.archive(eventId, session.id, archivedAt);
    assert.deepEqual(archived.archivedAt, archivedAt);
    assert.deepEqual(await sessions.list(eventId), []);
    assert.equal((await sessions.list(eventId, { includeArchived: true }))[0]?.id, session.id);
    assert.equal(archived.versions.length, 1);
    await expectRepositoryError(sessions.update(eventId, session.id, { title: "Resurrected" }), "invalid-input");
  });

  test("clones a session as a distinguishable unscheduled manual session", async () => {
    const eventId = await createEvent("cloned-session");
    const speaker = await createSpeaker(eventId, "clone@example.test", "Clone");
    const source = await sessions.createGuaranteed({
      eventId,
      contentApprovalStatus: ProgramSessionContentApprovalStatus.APPROVED,
      title: "Opening Keynote",
      description: "Original details",
      durationMinutes: 45,
      participants: [{ speakerId: speaker.id, role: ProgramSessionParticipantRole.CHAIRPERSON }],
    });

    const clone = await sessions.clone(eventId, source.id);

    assert.equal(clone.kind, ProgramSessionKind.MANUAL);
    assert.equal(clone.contentApprovalStatus, ProgramSessionContentApprovalStatus.DRAFT);
    assert.equal(clone.sourceSubmissionId, null);
    assert.equal(clone.version.title, "Opening Keynote (copy)");
    assert.equal(clone.version.description, source.version.description);
    assert.deepEqual(clone.version.participants, source.version.participants);
    assert.equal(await client.agendaPlacement.count({ where: { eventId, sessionId: clone.id } }), 0);
  });

  test("rejects source submissions, speakers, and tracks from another event", async () => {
    const eventId = await createEvent("session-event");
    const otherEventId = await createEvent("other-session-event");
    const { submissionId: sourceSubmissionId } = await createSubmission(eventId);
    const outsider = await createSpeaker(otherEventId, "outsider@example.test", "Outsider");
    const otherTrack = await tracks.create({ eventId: otherEventId, name: "Other", color: "red" });

    await expectRepositoryError(
      sessions.createManual({
        eventId,
        title: "Cross-event speaker",
        durationMinutes: 30,
        speakerIds: [outsider.id],
      }),
      "not-found",
    );
    await expectRepositoryError(
      sessions.createManual({
        eventId,
        title: "Cross-event track",
        durationMinutes: 30,
        trackId: otherTrack.id,
      }),
      "not-found",
    );
    await expectRepositoryError(
      sessions.promote({
        eventId: otherEventId,
        sourceSubmissionId,
      }),
      "not-found",
    );
  });

  test("converts and reverts subsessions while propagating participants and enforcing event-scoped limits", async () => {
    const eventId = await createEvent("nested-sessions");
    const otherEventId = await createEvent("nested-sessions-other");
    const parentSpeaker = await createSpeaker(eventId, "parent@example.test", "Parent");
    const childSpeaker = await createSpeaker(eventId, "child@example.test", "Child");
    const parent = await sessions.createManual({
      eventId,
      title: "Workshop block",
      durationMinutes: 120,
      speakerIds: [parentSpeaker.id],
    });
    const child = await sessions.createManual({
      eventId,
      title: "Focused exercise",
      durationMinutes: 30,
      speakerIds: [childSpeaker.id],
    });

    const nested = await sessions.update(eventId, child.id, { parentSessionId: parent.id });
    assert.equal(nested.parentSessionId, parent.id);
    assert.deepEqual((await sessions.get(eventId, parent.id))?.version.speakerIds, [parentSpeaker.id, childSpeaker.id]);

    const standalone = await sessions.update(eventId, child.id, { parentSessionId: null });
    assert.equal(standalone.parentSessionId, null);
    await expectRepositoryError(sessions.update(otherEventId, child.id, { parentSessionId: parent.id }), "not-found");

    for (let index = 0; index < MAX_SUBSESSIONS_PER_PARENT; index += 1) {
      await sessions.createManual({
        eventId,
        title: `Subsession ${index + 1}`,
        durationMinutes: 5,
        parentSessionId: parent.id,
      });
    }
    await expectRepositoryError(
      sessions.createManual({
        eventId,
        title: "One subsession too many",
        durationMinutes: 5,
        parentSessionId: parent.id,
      }),
      "invalid-input",
    );
  });
});
