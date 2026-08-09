import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionStatus,
  CfpSubmissionTransitionActor,
  EventType,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { DeterministicTokenGenerator } from "../infrastructure/index.ts";
import { SpeakerConfirmationService } from "./speaker-confirmations.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for speaker confirmation integration tests.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
let now = new Date("2027-05-01T18:00:00.000Z");
let confirmations: SpeakerConfirmationService;

interface ConfirmationFixture {
  readonly eventId: string;
  readonly submissionId: string;
  readonly speakerIds: readonly string[];
}

async function createFixture(speakerCount = 2, withTasks = true): Promise<ConfirmationFixture> {
  const event = await database.event.create({
    data: {
      name: "Speaker Confirmation Summit",
      slug: `speaker-confirmation-${randomUUID()}`,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-06-01T16:00:00.000Z"),
      endsAt: new Date("2027-06-03T00:00:00.000Z"),
      cfpForms: {
        create: {
          key: "main-cfp",
          versions: { create: { versionNumber: 1, schemaVersion: 1, title: "Confirmation CFP", customTypes: [] } },
        },
      },
    },
    include: { cfpForms: { include: { versions: true } } },
  });
  const formVersion = event.cfpForms[0]?.versions[0];
  if (!formVersion) throw new Error("Expected a CFP form version.");

  const speakers = await Promise.all(
    Array.from({ length: speakerCount }, async (_, index) =>
      database.speaker.create({
        data: {
          eventId: event.id,
          normalizedEmail: `speaker-${index + 1}@example.test`,
          profileVersions: {
            create: {
              versionNumber: 1,
              email: `speaker-${index + 1}@example.test`,
              givenName: `Speaker ${index + 1}`,
              familyName: "Example",
            },
          },
        },
      }),
    ),
  );
  const submission = await database.cfpSubmission.create({
    data: {
      eventId: event.id,
      formVersionId: formVersion.id,
      kind: CfpSubmissionKind.ABSTRACT,
      status: CfpSubmissionStatus.ACCEPTED,
      submittedAt: new Date("2027-04-01T18:00:00.000Z"),
      reviewStartedAt: new Date("2027-04-02T18:00:00.000Z"),
      decidedAt: new Date("2027-04-03T18:00:00.000Z"),
      participants: {
        create: speakers.map((speaker, sortOrder) => ({ speakerId: speaker.id, sortOrder })),
      },
    },
  });

  if (withTasks) {
    await database.speakerTaskDefinition.create({
      data: {
        eventId: event.id,
        key: "speaker-profile",
        versions: {
          create: {
            versionNumber: 1,
            sortOrder: 0,
            title: "Complete your speaker profile",
            applicability: { confirmedOnly: true, sessionKinds: [] },
            defaultDueOffsetDays: 3,
          },
        },
      },
    });
    await database.speakerTaskDefinition.create({
      data: {
        eventId: event.id,
        key: "promoted-session-only",
        versions: {
          create: {
            versionNumber: 1,
            sortOrder: 1,
            title: "Promoted session task",
            applicability: { confirmedOnly: true, sessionKinds: ["PROMOTED"] },
          },
        },
      },
    });
  }

  return { eventId: event.id, submissionId: submission.id, speakerIds: speakers.map(({ id }) => id) };
}

async function expectConfirmationError(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError);
}

describe("accepted speaker confirmation", () => {
  before(async () => {
    await database.$connect();
  });

  beforeEach(async () => {
    await database.event.deleteMany();
    now = new Date("2027-05-01T18:00:00.000Z");
    confirmations = new SpeakerConfirmationService({
      database,
      clock: { now: () => now },
      tokenGenerator: new DeterministicTokenGenerator(randomUUID()),
      invitationLifetimeMs: 60_000,
    });
  });

  after(async () => {
    await database.$disconnect();
  });

  test("confirms every participant once, bootstraps applicable tasks, and audits the final transition", async () => {
    const fixture = await createFixture();
    const invitations = await confirmations.issueInvitations(fixture.eventId, fixture.submissionId);
    assert.equal(invitations.length, 2);

    const first = invitations[0];
    const second = invitations[1];
    if (!first || !second) throw new Error("Expected two invitations.");
    const firstConfirmation = await confirmations.confirm(first);
    assert.equal(firstConfirmation.submissionConfirmed, false);
    assert.equal(firstConfirmation.assignmentsCreated, 1);
    assert.equal(
      (await database.cfpSubmission.findUniqueOrThrow({ where: { id: fixture.submissionId } })).status,
      CfpSubmissionStatus.ACCEPTED,
    );

    const secondConfirmation = await confirmations.confirm(second);
    assert.equal(secondConfirmation.submissionConfirmed, true);
    assert.equal(secondConfirmation.assignmentsCreated, 1);
    const stored = await database.cfpSubmission.findUniqueOrThrow({
      where: { id: fixture.submissionId },
      include: { participants: true, transitions: true },
    });
    assert.equal(stored.status, CfpSubmissionStatus.CONFIRMED);
    assert.ok(stored.confirmedAt);
    assert.ok(stored.participants.every(({ confirmedAt }) => confirmedAt !== null));
    assert.deepEqual(
      stored.transitions.map(({ actor, actorId }) => [actor, actorId]),
      [[CfpSubmissionTransitionActor.SPEAKER_CONFIRMATION, second.speakerId]],
    );
    assert.equal(await database.speakerTaskAssignment.count({ where: { eventId: fixture.eventId } }), 2);
    assert.equal(await database.speakerTaskAssignmentTransition.count({ where: { toStatus: "PENDING" } }), 2);
    assert.equal(await database.cfpSpeakerInvitation.count({ where: { consumedAt: { not: null } } }), 2);
  });

  test("rejects expired, replayed, cross-event, waitlisted, and rejected requests without state changes", async () => {
    const fixture = await createFixture(1, false);
    const invitation = (await confirmations.issueInvitations(fixture.eventId, fixture.submissionId))[0];
    if (!invitation) throw new Error("Expected an invitation.");

    await expectConfirmationError(confirmations.confirm({ ...invitation, eventId: randomUUID() }));
    now = new Date(invitation.expiresAt.getTime() + 1);
    await expectConfirmationError(confirmations.confirm(invitation));
    assert.equal(
      await database.cfpSubmissionParticipant.count({
        where: { submissionId: fixture.submissionId, confirmedAt: null },
      }),
      1,
    );

    now = new Date("2027-05-01T18:00:00.000Z");
    const waitlistedInvitation = (await confirmations.issueInvitations(fixture.eventId, fixture.submissionId))[0];
    if (!waitlistedInvitation) throw new Error("Expected a replacement invitation.");
    await database.cfpSubmission.update({
      where: { id: fixture.submissionId },
      data: { status: CfpSubmissionStatus.WAITLISTED },
    });
    await expectConfirmationError(confirmations.confirm(waitlistedInvitation));
    await database.cfpSubmission.update({
      where: { id: fixture.submissionId },
      data: { status: CfpSubmissionStatus.REJECTED },
    });
    await expectConfirmationError(confirmations.confirm(waitlistedInvitation));
    assert.equal(await database.speakerSession.count(), 0);
    assert.equal(await database.speakerTaskAssignment.count(), 0);
    assert.equal(
      await database.cfpSubmissionParticipant.count({
        where: { submissionId: fixture.submissionId, confirmedAt: null },
      }),
      1,
    );
  });

  test("invalidates an earlier invitation on reissue and rejects replay after a successful confirmation", async () => {
    const fixture = await createFixture(1, false);
    const first = (await confirmations.issueInvitations(fixture.eventId, fixture.submissionId))[0];
    const replacement = (await confirmations.issueInvitations(fixture.eventId, fixture.submissionId))[0];
    if (!first || !replacement) throw new Error("Expected invitation reissue.");

    await expectConfirmationError(confirmations.confirm(first));
    await confirmations.confirm(replacement);
    await expectConfirmationError(confirmations.confirm(replacement));
    assert.equal(await database.cfpSpeakerInvitation.count({ where: { submissionId: fixture.submissionId } }), 2);
    assert.equal(await database.cfpSubmissionTransition.count({ where: { submissionId: fixture.submissionId } }), 1);
    assert.equal(await database.speakerSession.count(), 1);
  });

  test("serializes concurrent confirmation and succeeds when no onboarding task applies", async () => {
    const fixture = await createFixture(1, false);
    const invitation = (await confirmations.issueInvitations(fixture.eventId, fixture.submissionId))[0];
    if (!invitation) throw new Error("Expected an invitation.");

    const attempts = await Promise.allSettled([confirmations.confirm(invitation), confirmations.confirm(invitation)]);
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);
    assert.equal(await database.speakerTaskAssignment.count(), 0);
    assert.equal(await database.cfpSubmissionTransition.count({ where: { submissionId: fixture.submissionId } }), 1);
    assert.equal(
      (await database.cfpSubmission.findUniqueOrThrow({ where: { id: fixture.submissionId } })).status,
      CfpSubmissionStatus.CONFIRMED,
    );
  });
});
