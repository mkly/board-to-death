import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionStatus,
  PrismaClient,
  ProgramSessionKind,
  ProgramSessionParticipantRole,
  SpeakerTaskAssignmentStatus,
} from "../../generated/prisma/client.ts";
import { RecipientAudienceRepository } from "./audiences.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for recipient audience integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const audiences = new RecipientAudienceRepository(client);

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: slug,
      slug,
      timezone: "UTC",
      startsAt: new Date("2027-06-01T09:00:00.000Z"),
      endsAt: new Date("2027-06-02T17:00:00.000Z"),
    },
  });
}

async function createFormVersion(eventId: string) {
  const form = await client.cfpForm.create({
    data: {
      eventId,
      key: "main",
      versions: { create: { versionNumber: 1, schemaVersion: 1, title: "Main CFP", customTypes: {} } },
    },
    include: { versions: true },
  });
  const version = form.versions[0];
  assert.ok(version);
  return version;
}

async function createSpeaker(eventId: string, name: string, consentToReceiveEmail = true) {
  const email = `${name.toLowerCase()}@example.test`;
  return client.speaker.create({
    data: {
      eventId,
      normalizedEmail: email,
      profileVersions: {
        create: {
          versionNumber: 1,
          email,
          givenName: name,
          familyName: "Speaker",
          consentToReceiveEmail,
          consentedAt: consentToReceiveEmail ? new Date("2027-01-01T00:00:00.000Z") : null,
        },
      },
    },
  });
}

async function createSubmission(
  eventId: string,
  formVersionId: string,
  speakerId: string,
  status: CfpSubmissionStatus,
  categoryId?: string,
) {
  const submittedAt = status === CfpSubmissionStatus.DRAFT ? null : new Date("2027-01-10T00:00:00.000Z");
  const reviewStartedAt =
    status === CfpSubmissionStatus.DRAFT || status === CfpSubmissionStatus.SUBMITTED
      ? null
      : new Date("2027-01-11T00:00:00.000Z");
  const decidedAt =
    status === CfpSubmissionStatus.WAITLISTED ||
    status === CfpSubmissionStatus.ACCEPTED ||
    status === CfpSubmissionStatus.REJECTED ||
    status === CfpSubmissionStatus.CONFIRMED
      ? new Date("2027-01-12T00:00:00.000Z")
      : null;
  return client.cfpSubmission.create({
    data: {
      eventId,
      formVersionId,
      kind: "ABSTRACT",
      status,
      submittedAt,
      reviewStartedAt,
      decidedAt,
      confirmedAt: status === CfpSubmissionStatus.CONFIRMED ? new Date("2027-01-13T00:00:00.000Z") : null,
      participants: { create: { speakerId, sortOrder: 0 } },
      ...(categoryId ? { categories: { create: { categoryId, sortOrder: 0 } } } : {}),
    },
  });
}

async function createSession(
  eventId: string,
  speakerIds: readonly string[],
  roles: readonly ProgramSessionParticipantRole[] = [],
) {
  return client.programSession.create({
    data: {
      eventId,
      kind: ProgramSessionKind.MANUAL,
      versions: {
        create: {
          versionNumber: 1,
          title: "Opening keynote",
          durationMinutes: 45,
          participants: {
            create: speakerIds.map((speakerId, sortOrder) => ({
              speakerId,
              sortOrder,
              role: roles[sortOrder] ?? ProgramSessionParticipantRole.SPEAKER,
            })),
          },
        },
      },
    },
  });
}

async function createOnboardingAssignment(eventId: string, speakerId: string, status: SpeakerTaskAssignmentStatus) {
  const definition = await client.speakerTaskDefinition.create({
    data: {
      eventId,
      key: `task-${speakerId}`,
      versions: {
        create: { versionNumber: 1, sortOrder: 0, title: "Review profile", applicability: {} },
      },
    },
    include: { versions: true },
  });
  const version = definition.versions[0];
  assert.ok(version);
  const submittedAt =
    status === SpeakerTaskAssignmentStatus.SUBMITTED ||
    status === SpeakerTaskAssignmentStatus.REVISION_REQUESTED ||
    status === SpeakerTaskAssignmentStatus.APPROVED
      ? new Date("2027-02-01T00:00:00.000Z")
      : null;
  return client.speakerTaskAssignment.create({
    data: {
      eventId,
      definitionId: definition.id,
      definitionVersionId: version.id,
      speakerId,
      status,
      submittedAt,
      completedAt: status === SpeakerTaskAssignmentStatus.APPROVED ? new Date("2027-02-02T00:00:00.000Z") : null,
      withdrawnAt: status === SpeakerTaskAssignmentStatus.WITHDRAWN ? new Date("2027-02-02T00:00:00.000Z") : null,
    },
  });
}

describe("recipient audience previews", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("unions filter combinations, deduplicates overlaps, and explains email exclusions", async () => {
    const event = await createEvent("audience-overlap");
    const form = await createFormVersion(event.id);
    const category = await client.cfpCategory.create({
      data: { eventId: event.id, key: "design", label: "Game design" },
    });
    const ada = await createSpeaker(event.id, "Ada");
    const grace = await createSpeaker(event.id, "Grace");
    const lin = await createSpeaker(event.id, "Lin", false);
    await Promise.all([
      createSubmission(event.id, form.id, ada.id, CfpSubmissionStatus.ACCEPTED, category.id),
      createSubmission(event.id, form.id, grace.id, CfpSubmissionStatus.ACCEPTED, category.id),
      createSubmission(event.id, form.id, lin.id, CfpSubmissionStatus.ACCEPTED, category.id),
    ]);
    const session = await createSession(
      event.id,
      [ada.id, grace.id],
      [ProgramSessionParticipantRole.MODERATOR, ProgramSessionParticipantRole.CHAIRPERSON],
    );
    await createOnboardingAssignment(event.id, grace.id, SpeakerTaskAssignmentStatus.APPROVED);

    const preview = await audiences.preview(event.id, {
      speakerIds: [ada.id, ada.id],
      acceptanceStatuses: [CfpSubmissionStatus.ACCEPTED],
      sessionIds: [session.id],
      participantRoles: [ProgramSessionParticipantRole.MODERATOR],
      categoryIds: [category.id],
      onboardingStatuses: [SpeakerTaskAssignmentStatus.APPROVED],
    });

    assert.deepEqual(preview.recipients.map(({ displayName }) => displayName).sort(), ["Ada Speaker", "Grace Speaker"]);
    assert.deepEqual(
      preview.recipients.find(({ speakerId }) => speakerId === ada.id)?.matches.map(({ kind }) => kind),
      ["explicit", "acceptance", "session", "role", "category"],
    );
    assert.deepEqual(
      preview.recipients.find(({ speakerId }) => speakerId === grace.id)?.matches.map(({ kind }) => kind),
      ["acceptance", "session", "category", "onboarding"],
    );
    assert.deepEqual(
      preview.excluded.map(({ displayName, reason }) => [displayName, reason]),
      [["Lin Speaker", "email-opt-out"]],
    );
  });

  test("returns an exact empty preview when no current speaker matches", async () => {
    const event = await createEvent("audience-empty");
    const form = await createFormVersion(event.id);
    const speaker = await createSpeaker(event.id, "Ada");
    await createSubmission(event.id, form.id, speaker.id, CfpSubmissionStatus.REJECTED);

    assert.deepEqual(await audiences.preview(event.id, { acceptanceStatuses: [CfpSubmissionStatus.ACCEPTED] }), {
      recipients: [],
      excluded: [],
    });
  });

  test("recomputes a cohort after its underlying acceptance state changes", async () => {
    const event = await createEvent("audience-freshness");
    const form = await createFormVersion(event.id);
    const speaker = await createSpeaker(event.id, "Ada");
    const submission = await createSubmission(event.id, form.id, speaker.id, CfpSubmissionStatus.ACCEPTED);

    assert.equal(
      (await audiences.preview(event.id, { acceptanceStatuses: [CfpSubmissionStatus.ACCEPTED] })).recipients.length,
      1,
    );
    await client.cfpSubmission.update({
      where: { id: submission.id },
      data: { status: CfpSubmissionStatus.REJECTED },
    });
    assert.equal(
      (await audiences.preview(event.id, { acceptanceStatuses: [CfpSubmissionStatus.ACCEPTED] })).recipients.length,
      0,
    );
  });

  test("does not resolve explicit, session, category, or onboarding criteria across events", async () => {
    const event = await createEvent("audience-scope");
    const other = await createEvent("other-audience-scope");
    const form = await createFormVersion(other.id);
    const category = await client.cfpCategory.create({
      data: { eventId: other.id, key: "foreign", label: "Foreign" },
    });
    const speaker = await createSpeaker(other.id, "Foreign");
    await createSubmission(other.id, form.id, speaker.id, CfpSubmissionStatus.ACCEPTED, category.id);
    const session = await createSession(other.id, [speaker.id]);
    await createOnboardingAssignment(other.id, speaker.id, SpeakerTaskAssignmentStatus.PENDING);

    assert.deepEqual(
      await audiences.preview(event.id, {
        speakerIds: [speaker.id],
        acceptanceStatuses: [CfpSubmissionStatus.ACCEPTED],
        sessionIds: [session.id],
        participantRoles: [ProgramSessionParticipantRole.SPEAKER],
        categoryIds: [category.id],
        onboardingStatuses: [SpeakerTaskAssignmentStatus.PENDING],
      }),
      { recipients: [], excluded: [] },
    );
  });
});
