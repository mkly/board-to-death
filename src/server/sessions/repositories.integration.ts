import { PrismaPg } from "@prisma/adapter-pg";

import { CfpSubmissionKind, EventType, PrismaClient, ProgramSessionKind } from "../../generated/prisma/client.ts";
import type { CfpFormDefinition } from "../../lib/cfp/index.ts";
import { CfpFormRepository } from "../cfp/repositories.ts";
import { CfpSubmissionRepository } from "../cfp/submissions.ts";
import { EventRepository, RepositoryError, TrackRepository } from "../events/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { ProgramSessionRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for program session repository integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const tracks = new TrackRepository(client);
const forms = new CfpFormRepository(client);
const submissions = new CfpSubmissionRepository(client);
const speakers = new SpeakerRepository(client);
const sessions = new ProgramSessionRepository(client);

const definition: CfpFormDefinition = {
  version: 1,
  title: "Program CFP",
  sections: [{ id: "proposal", kind: "questions", title: "Proposal", questions: [] }],
};

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

async function createSubmission(eventId: string): Promise<string> {
  const form = await forms.create({ eventId, key: "main-cfp", definition });
  const version = await client.cfpFormVersion.findUniqueOrThrow({
    where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
  });
  const submission = await submissions.createDraft({
    eventId,
    formVersionId: version.id,
    kind: CfpSubmissionKind.ABSTRACT,
    answers: [],
  });
  return submission.id;
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

  test("creates manual and guaranteed sessions with immutable versions and ordered speakers", async () => {
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
      speakerIds: [coSpeaker.id, primary.id],
    });
    assert.equal(manual.kind, ProgramSessionKind.MANUAL);
    assert.deepEqual(manual.version.speakerIds, [coSpeaker.id, primary.id]);

    const edited = await sessions.update(eventId, manual.id, {
      title: "Designing Better Together",
      durationMinutes: 60,
      speakerIds: [primary.id, coSpeaker.id],
    });
    assert.deepEqual(
      edited.versions.map(({ versionNumber, title, durationMinutes, speakerIds }) => ({
        versionNumber,
        title,
        durationMinutes,
        speakerIds,
      })),
      [
        {
          versionNumber: 1,
          title: "Designing Together",
          durationMinutes: 45,
          speakerIds: [coSpeaker.id, primary.id],
        },
        {
          versionNumber: 2,
          title: "Designing Better Together",
          durationMinutes: 60,
          speakerIds: [primary.id, coSpeaker.id],
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
  });

  test("links one promoted session to its source while allowing independent later edits", async () => {
    const eventId = await createEvent("promoted-session");
    const sourceSubmissionId = await createSubmission(eventId);
    const speaker = await createSpeaker(eventId, "promoted@example.test", "Promoted");
    const promoted = await sessions.promote({
      eventId,
      sourceSubmissionId,
      title: "From Abstract to Program",
      description: "Copied from the accepted submission.",
      durationMinutes: 45,
      speakerIds: [speaker.id],
    });

    assert.equal(promoted.kind, ProgramSessionKind.PROMOTED);
    assert.equal(promoted.sourceSubmissionId, sourceSubmissionId);
    await expectRepositoryError(
      sessions.promote({
        eventId,
        sourceSubmissionId,
        title: "Duplicate promotion",
        durationMinutes: 45,
      }),
      "conflict",
    );

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

  test("rejects source submissions, speakers, and tracks from another event", async () => {
    const eventId = await createEvent("session-event");
    const otherEventId = await createEvent("other-session-event");
    const sourceSubmissionId = await createSubmission(eventId);
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
        title: "Cross-event promotion",
        durationMinutes: 30,
      }),
      "not-found",
    );
  });
});
