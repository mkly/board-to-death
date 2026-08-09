import { PrismaPg } from "@prisma/adapter-pg";

import { CfpSubmissionKind, EventType, PrismaClient } from "../../generated/prisma/client.ts";
import type { CfpFormDefinition } from "../../lib/cfp/index.ts";
import { CfpFormRepository } from "../cfp/repositories.ts";
import { CfpSubmissionRepository } from "../cfp/submissions.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { SpeakerRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for speaker repository integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const forms = new CfpFormRepository(client);
const submissions = new CfpSubmissionRepository(client);
const speakers = new SpeakerRepository(client);

const definition: CfpFormDefinition = {
  version: 1,
  title: "Speaker CFP",
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

describe("speaker persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("keeps event-scoped identity while allowing the same person at another event", async () => {
    const firstEventId = await createEvent("first-event");
    const secondEventId = await createEvent("second-event");
    const first = await speakers.create({
      eventId: firstEventId,
      email: "  ALEX@EXAMPLE.TEST ",
      givenName: "Alex",
      familyName: "Rivera",
      phone: "+1 555 0100",
      organization: "Tabletop Guild",
      jobTitle: "Designer",
    });
    const second = await createSpeaker(secondEventId, "alex@example.test", "Alex");

    assert.notEqual(first.id, second.id);
    assert.equal(first.profile.email, "alex@example.test");
    assert.equal((await speakers.list(firstEventId)).length, 1);
    await expectRepositoryError(createSpeaker(firstEventId, "Alex@example.test", "Duplicate"), "conflict");
  });

  test("preserves numbered profile, biography, contact, and consent revisions", async () => {
    const eventId = await createEvent("profile-history");
    const created = await createSpeaker(eventId, "sam@example.test", "Sam");
    const consentedAt = new Date("2027-01-05T12:00:00.000Z");

    const updated = await speakers.updateProfile(
      eventId,
      created.id,
      {
        preferredName: "Sammie",
        pronouns: "they/them",
        biography: "Designs cooperative games.",
        websiteUrl: "https://example.test/sam",
        accessibilityNeeds: "A step-free route to the stage.",
        photoObjectKey: "events/profile-history/speakers/sam/photo.jpg",
        consentToPublishProfile: true,
        consentToReceiveEmail: true,
        consentedAt,
      },
      1,
    );

    assert.deepEqual(
      updated.profileVersions.map(({ versionNumber, preferredName }) => [versionNumber, preferredName]),
      [
        [1, null],
        [2, "Sammie"],
      ],
    );
    assert.equal(updated.profile.biography, "Designs cooperative games.");
    assert.equal(updated.profile.accessibilityNeeds, "A step-free route to the stage.");
    assert.equal(updated.profile.consentToPublishProfile, true);
    assert.deepEqual(updated.profile.consentedAt, consentedAt);
    assert.equal(updated.profileVersions[0]?.biography, null);

    await expectRepositoryError(
      speakers.updateProfile(eventId, created.id, { biography: "A stale edit." }, 1),
      "conflict",
    );
    assert.equal((await speakers.get(eventId, created.id))?.profile.biography, "Designs cooperative games.");
  });

  test("stores one or many participants in deterministic order and rejects cross-event assignments", async () => {
    const eventId = await createEvent("ordered-participants");
    const otherEventId = await createEvent("other-participants");
    const submissionId = await createSubmission(eventId);
    const primary = await createSpeaker(eventId, "primary@example.test", "Primary");
    const coSpeaker = await createSpeaker(eventId, "co@example.test", "Co");
    const outsider = await createSpeaker(otherEventId, "outsider@example.test", "Outsider");

    const one = await speakers.replaceSubmissionParticipants(eventId, submissionId, [primary.id]);
    assert.deepEqual(
      one.map(({ speaker }) => speaker.id),
      [primary.id],
    );

    const reordered = await speakers.replaceSubmissionParticipants(eventId, submissionId, [coSpeaker.id, primary.id]);
    assert.deepEqual(
      reordered.map(({ sortOrder, speaker }) => [sortOrder, speaker.id]),
      [
        [0, coSpeaker.id],
        [1, primary.id],
      ],
    );
    await expectRepositoryError(
      speakers.replaceSubmissionParticipants(eventId, submissionId, [primary.id, primary.id]),
      "invalid-input",
    );
    await expectRepositoryError(
      speakers.replaceSubmissionParticipants(eventId, submissionId, [primary.id, outsider.id]),
      "not-found",
    );
    assert.deepEqual(
      (await speakers.listSubmissionParticipants(eventId, submissionId)).map(({ speaker }) => speaker.id),
      [coSpeaker.id, primary.id],
    );
  });

  test("stores participant file keys per speaker and refuses speakers outside the submission", async () => {
    const eventId = await createEvent("participant-files");
    const otherEventId = await createEvent("other-participant-files");
    const submissionId = await createSubmission(eventId);
    const otherSubmissionId = await createSubmission(eventId);
    const primary = await createSpeaker(eventId, "files-primary@example.test", "Primary");
    const coSpeaker = await createSpeaker(eventId, "files-co@example.test", "Co");
    const outsider = await createSpeaker(otherEventId, "files-outsider@example.test", "Outsider");
    await speakers.replaceSubmissionParticipants(eventId, submissionId, [primary.id, coSpeaker.id]);

    assert.deepEqual(
      await speakers.getSubmissionParticipant(eventId, submissionId, primary.id).then((participant) => [
        participant?.speaker.id,
        participant?.slidesObjectKey,
        participant?.supportingDocumentObjectKey,
      ]),
      [primary.id, null, null],
    );

    const withSlides = await speakers.updateSubmissionParticipantFiles(eventId, submissionId, primary.id, {
      slidesObjectKey: "events/e/speakers/primary/slides-1",
    });
    assert.equal(withSlides.slidesObjectKey, "events/e/speakers/primary/slides-1");
    assert.equal(withSlides.supportingDocumentObjectKey, null);

    // A second purpose is set independently, and replacing one key leaves the other untouched.
    await speakers.updateSubmissionParticipantFiles(eventId, submissionId, primary.id, {
      supportingDocumentObjectKey: "events/e/speakers/primary/doc-1",
    });
    const replaced = await speakers.updateSubmissionParticipantFiles(eventId, submissionId, primary.id, {
      slidesObjectKey: "events/e/speakers/primary/slides-2",
    });
    assert.equal(replaced.slidesObjectKey, "events/e/speakers/primary/slides-2");
    assert.equal(replaced.supportingDocumentObjectKey, "events/e/speakers/primary/doc-1");

    const cleared = await speakers.updateSubmissionParticipantFiles(eventId, submissionId, primary.id, {
      slidesObjectKey: null,
    });
    assert.equal(cleared.slidesObjectKey, null);
    assert.equal(cleared.supportingDocumentObjectKey, "events/e/speakers/primary/doc-1");

    // One participant's files never leak onto a co-speaker's row.
    const co = await speakers.getSubmissionParticipant(eventId, submissionId, coSpeaker.id);
    assert.equal(co?.slidesObjectKey, null);
    assert.equal(co?.supportingDocumentObjectKey, null);

    assert.equal(await speakers.getSubmissionParticipant(eventId, otherSubmissionId, primary.id), null);
    assert.equal(await speakers.getSubmissionParticipant(eventId, submissionId, outsider.id), null);
    assert.equal(await speakers.getSubmissionParticipant(otherEventId, submissionId, primary.id), null);
    await expectRepositoryError(
      speakers.updateSubmissionParticipantFiles(eventId, submissionId, outsider.id, { slidesObjectKey: "forged" }),
      "not-found",
    );
    await expectRepositoryError(
      speakers.updateSubmissionParticipantFiles(otherEventId, submissionId, primary.id, { slidesObjectKey: "forged" }),
      "not-found",
    );
    await expectRepositoryError(
      speakers.updateSubmissionParticipantFiles(eventId, otherSubmissionId, primary.id, { slidesObjectKey: "forged" }),
      "not-found",
    );
    assert.equal(
      (await speakers.getSubmissionParticipant(eventId, submissionId, primary.id))?.supportingDocumentObjectKey,
      "events/e/speakers/primary/doc-1",
    );
  });

  test("keeps the speaker agreement key across unrelated profile edits", async () => {
    const eventId = await createEvent("agreement-key");
    const speaker = await createSpeaker(eventId, "agreement@example.test", "Agreed");

    await speakers.updateProfile(eventId, speaker.id, { agreementObjectKey: "events/e/speakers/s/agreement-1" });
    const edited = await speakers.updateProfile(eventId, speaker.id, { biography: "Writes rules." });
    assert.equal(edited.profile.agreementObjectKey, "events/e/speakers/s/agreement-1");

    const removed = await speakers.updateProfile(eventId, speaker.id, { agreementObjectKey: null });
    assert.equal(removed.profile.agreementObjectKey, null);
    assert.equal(removed.profile.biography, "Writes rules.");
  });

  test("restricts deletion of assigned speakers and cascades links when their submission is deleted", async () => {
    const eventId = await createEvent("speaker-deletion");
    const submissionId = await createSubmission(eventId);
    const speaker = await createSpeaker(eventId, "linked@example.test", "Linked");
    await speakers.replaceSubmissionParticipants(eventId, submissionId, [speaker.id]);

    await expectRepositoryError(speakers.delete(eventId, speaker.id), "conflict");
    await client.cfpSubmission.delete({ where: { id: submissionId } });
    assert.equal(await client.cfpSubmissionParticipant.count({ where: { speakerId: speaker.id } }), 0);
    await speakers.delete(eventId, speaker.id);
    assert.equal(await speakers.get(eventId, speaker.id), null);
    assert.equal(await client.speakerProfileVersion.count({ where: { speakerId: speaker.id } }), 0);

    const cascadeEventId = await createEvent("speaker-event-cascade");
    const cascadeSubmissionId = await createSubmission(cascadeEventId);
    const cascadeSpeaker = await createSpeaker(cascadeEventId, "cascade@example.test", "Cascade");
    await speakers.replaceSubmissionParticipants(cascadeEventId, cascadeSubmissionId, [cascadeSpeaker.id]);
    await client.event.delete({ where: { id: cascadeEventId } });
    assert.equal(await client.speaker.count({ where: { id: cascadeSpeaker.id } }), 0);
    assert.equal(await client.cfpSubmissionParticipant.count({ where: { speakerId: cascadeSpeaker.id } }), 0);
  });
});
