import { PrismaPg } from "@prisma/adapter-pg";

import { CfpSubmissionStatus, EventType, PrismaClient, ProgramSessionKind } from "../../generated/prisma/client.ts";
import type { CfpFormDefinition } from "../../lib/cfp/index.ts";
import { CfpFormRepository } from "../cfp/repositories.ts";
import { EventRepository, RepositoryError, TrackRepository } from "../events/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { AdminIntakeRepository } from "./admin-intake.ts";
import { adminIntakeCsvTemplate, parseAdminIntakeCsv } from "./csv.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for admin intake integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const forms = new CfpFormRepository(client);
const speakers = new SpeakerRepository(client);
const tracks = new TrackRepository(client);
const intake = new AdminIntakeRepository(client);

const definition: CfpFormDefinition = {
  version: 1,
  title: "Admin abstract intake",
  submissionKind: "ABSTRACT",
  minimumSpeakerCount: 1,
  maximumSpeakerCount: 3,
  requiredSpeakerFields: [],
  sections: [
    {
      id: "proposal",
      kind: "questions",
      title: "Proposal",
      questions: [
        { id: "title", type: "short_text", label: "Title", required: true },
        { id: "summary", type: "long_text", label: "Summary", required: true },
      ],
    },
  ],
};

async function seedEvent(slug: string) {
  const event = await events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-03-13T17:00:00.000Z"),
    endsAt: new Date("2027-03-15T00:00:00.000Z"),
  });
  const form = await forms.create({ eventId: event.id, key: "main-cfp", definition });
  const version = await client.cfpFormVersion.findUniqueOrThrow({
    where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
  });
  const first = await speakers.create({
    eventId: event.id,
    email: `${slug}-first@example.test`,
    givenName: "First",
    familyName: "Speaker",
  });
  const second = await speakers.create({
    eventId: event.id,
    email: `${slug}-second@example.test`,
    givenName: "Second",
    familyName: "Speaker",
  });
  return { event, formVersionId: version.id, first, second };
}

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

describe("admin abstract and session intake", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("creates and updates an audited abstract with ordered event participants", async () => {
    const seeded = await seedEvent("admin-abstract-intake");
    const input = {
      eventId: seeded.event.id,
      clientIdentifier: "Partner:Abstract-42",
      formVersionId: seeded.formVersionId,
      status: CfpSubmissionStatus.ACCEPTED,
      values: { title: "Designing safer tables", summary: "A practical abstract." },
      speakerIds: [seeded.second.id, seeded.first.id],
      actorId: "ADMIN@EXAMPLE.TEST",
      source: "manual" as const,
    };

    const created = await intake.upsertAbstract(input);
    assert.equal(created.outcome, "created");
    const stored = await client.cfpSubmission.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        participants: { orderBy: { sortOrder: "asc" } },
        revisions: { orderBy: { versionNumber: "asc" } },
        transitions: { orderBy: { occurredAt: "asc" } },
      },
    });
    assert.equal(stored.intakeClientIdentifier, "partner:abstract-42");
    assert.equal(stored.intakeCreatedBy, "admin@example.test");
    assert.equal(stored.intakeUpdatedBy, "admin@example.test");
    assert.equal(stored.status, CfpSubmissionStatus.ACCEPTED);
    assert.deepEqual(
      stored.participants.map(({ speakerId }) => speakerId),
      [seeded.second.id, seeded.first.id],
    );
    assert.equal(stored.transitions[0]?.actor, "ADMIN");

    const unchanged = await intake.upsertAbstract({ ...input, source: "csv" });
    assert.equal(unchanged.outcome, "unchanged");
    const updated = await intake.upsertAbstract({
      ...input,
      values: { title: "Designing safer tables", summary: "Updated by the partner feed." },
      source: "csv",
    });
    assert.equal(updated.outcome, "updated");
    const afterUpdate = await client.cfpSubmission.findUniqueOrThrow({
      where: { id: created.id },
      include: { revisions: true, transitions: true },
    });
    assert.equal(afterUpdate.revisions.length, 2);
    assert.equal(afterUpdate.transitions.length, 1);
    assert.ok(afterUpdate.intakeImportedAt);
  });

  test("previews, creates, updates, and retries a guaranteed session without crossing event boundaries", async () => {
    const seeded = await seedEvent("admin-session-intake");
    const other = await seedEvent("other-admin-session-intake");
    const track = await tracks.create({ eventId: seeded.event.id, name: "Main stage", color: "blue" });
    const input = {
      eventId: seeded.event.id,
      clientIdentifier: "partner-session-7",
      title: "Opening keynote",
      description: "Opening remarks.",
      durationMinutes: 30,
      trackId: track.id,
      speakerIds: [seeded.first.id],
      actorId: "admin@example.test",
      source: "csv" as const,
    };

    assert.equal((await intake.upsertGuaranteedSession({ ...input, previewOnly: true })).outcome, "created");
    const created = await intake.upsertGuaranteedSession(input);
    assert.equal(created.outcome, "created");
    assert.equal((await intake.upsertGuaranteedSession(input)).outcome, "unchanged");
    assert.equal(
      (await intake.upsertGuaranteedSession({ ...input, title: "Opening keynote and welcome" })).outcome,
      "updated",
    );
    const stored = await client.programSession.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        versions: { orderBy: { versionNumber: "asc" }, include: { participants: true } },
      },
    });
    assert.equal(stored.kind, ProgramSessionKind.GUARANTEED);
    assert.equal(stored.versions.length, 2);
    assert.equal(stored.intakeCreatedBy, "admin@example.test");
    assert.ok(stored.intakeImportedAt);

    await expectRepositoryError(
      intake.upsertGuaranteedSession({ ...input, clientIdentifier: "wrong-event", speakerIds: [other.first.id] }),
      "not-found",
    );
    await expectRepositoryError(
      intake.upsertAbstract({
        eventId: seeded.event.id,
        clientIdentifier: input.clientIdentifier,
        formVersionId: seeded.formVersionId,
        status: CfpSubmissionStatus.SUBMITTED,
        values: { title: "Collision", summary: "Must not overwrite the session." },
        speakerIds: [seeded.first.id],
        actorId: input.actorId,
        source: "csv",
      }),
      "conflict",
    );
  });

  test("parses quoted CSV values and reports duplicate and malformed rows before apply", async () => {
    const templateRows = await parseAdminIntakeCsv(adminIntakeCsvTemplate());
    assert.equal(templateRows.length, 2);
    assert.equal(templateRows[0]?.participantEmails.length, 2);
    assert.deepEqual(templateRows[0]?.answers, {
      title: "Designing safer game nights",
      summary: "A practical session.",
    });

    const malformed = await parseAdminIntakeCsv(
      `${adminIntakeCsvTemplate().split("\r\n")[0]}\r\n` +
        '"duplicate","abstract","SUBMITTED","main-cfp","","","","","","","{broken"\r\n' +
        '"duplicate","guaranteed_session","","","Title","","30","","","",""\r\n',
    );
    assert.ok(malformed[0]?.parseErrors.includes("answers_json must contain valid JSON."));
    assert.ok(malformed[1]?.parseErrors.some((message) => message.includes("duplicates row 2")));
  });
});
