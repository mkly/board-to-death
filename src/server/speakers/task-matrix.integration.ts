import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client.ts";
import { createSpeakerTaskMatrixCsv, SpeakerTaskMatrixRepository } from "./task-matrix.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for speaker task matrix integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const now = new Date("2027-03-14T08:30:00.000Z");
const repository = new SpeakerTaskMatrixRepository(client, () => now);

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: slug,
      slug,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-05-10T16:00:00.000Z"),
      endsAt: new Date("2027-05-12T00:00:00.000Z"),
    },
  });
}

async function createSpeaker(eventId: string, email: string, status: "ACCEPTED" | "CONFIRMED") {
  const speaker = await client.speaker.create({
    data: {
      eventId,
      normalizedEmail: email,
      profileVersions: {
        create: {
          versionNumber: 1,
          email,
          givenName: email.startsWith("ada") ? "=Ada" : "Grace",
          familyName: email.startsWith("ada") ? "Lovelace" : "Hopper",
        },
      },
    },
  });
  const form = await client.cfpForm.create({
    data: {
      eventId,
      key: `form-${speaker.id}`,
      versions: { create: { versionNumber: 1, schemaVersion: 1, title: "CFP", customTypes: {} } },
    },
    include: { versions: true },
  });
  const formVersion = form.versions[0];
  assert.ok(formVersion);
  await client.cfpSubmission.create({
    data: {
      eventId,
      formVersionId: formVersion.id,
      kind: "ABSTRACT",
      status,
      submittedAt: now,
      reviewStartedAt: now,
      decidedAt: now,
      confirmedAt: status === "CONFIRMED" ? now : null,
      participants: { create: { speakerId: speaker.id, sortOrder: 0 } },
    },
  });
  return speaker;
}

async function createTask(eventId: string, key: string, sortOrder: number, confirmedOnly = false) {
  return client.speakerTaskDefinition.create({
    data: {
      eventId,
      key,
      versions: {
        create: {
          versionNumber: 1,
          sortOrder,
          title: key === "bio" ? "Review biography" : "Sign agreement",
          applicability: { confirmedOnly },
        },
      },
    },
    include: { versions: true },
  });
}

describe("speaker task matrix", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("derives authoritative states, event-local overdue dates, filters, and event isolation", async () => {
    const event = await createEvent("matrix-event");
    const otherEvent = await createEvent("other-matrix-event");
    const ada = await createSpeaker(event.id, "ada@example.test", "CONFIRMED");
    const grace = await createSpeaker(event.id, "grace@example.test", "ACCEPTED");
    await createSpeaker(otherEvent.id, "other@example.test", "CONFIRMED");
    const biography = await createTask(event.id, "bio", 0);
    const agreement = await createTask(event.id, "agreement", 1, true);
    await createTask(otherEvent.id, "other", 0);
    const biographyVersion = biography.versions[0];
    assert.ok(biographyVersion);

    await client.speakerTaskAssignment.createMany({
      data: [
        {
          eventId: event.id,
          definitionId: biography.id,
          definitionVersionId: biographyVersion.id,
          speakerId: ada.id,
          status: "PENDING",
          assignedAt: new Date("2027-03-10T08:00:00.000Z"),
          dueAt: new Date("2027-03-14T07:59:59.000Z"),
        },
        {
          eventId: event.id,
          definitionId: biography.id,
          definitionVersionId: biographyVersion.id,
          speakerId: grace.id,
          status: "APPROVED",
          assignedAt: new Date("2027-03-10T08:00:00.000Z"),
          dueAt: new Date("2027-03-20T06:59:59.000Z"),
          submittedAt: new Date("2027-03-12T17:00:00.000Z"),
          completedAt: new Date("2027-03-12T18:00:00.000Z"),
        },
      ],
    });

    const result = await repository.list(event.id, event.timezone);
    assert.equal(result.rows.length, 4);
    assert.deepEqual(
      result.rows.map(({ speakerEmail, taskTitle, state }) => [speakerEmail, taskTitle, state]),
      [
        ["ada@example.test", "Review biography", "overdue"],
        ["ada@example.test", "Sign agreement", "outstanding"],
        ["grace@example.test", "Review biography", "complete"],
        ["grace@example.test", "Sign agreement", "not-applicable"],
      ],
    );
    assert.deepEqual(result.counts, {
      outstanding: 1,
      overdue: 1,
      complete: 1,
      withdrawn: 0,
      "not-applicable": 1,
    });

    const filtered = await repository.list(event.id, event.timezone, {
      search: "Ada",
      state: "overdue",
      dueFrom: "2027-03-13",
      dueTo: "2027-03-13",
    });
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.rows[0]?.speakerId, ada.id);
    assert.equal(
      filtered.tasks.some(({ id }) => id === agreement.id),
      true,
    );
    assert.equal(
      filtered.rows.some(({ speakerEmail }) => speakerEmail === "other@example.test"),
      false,
    );
  });

  test("exports stable columns, local due dates, and formula-safe cells", () => {
    const csv = new TextDecoder().decode(
      createSpeakerTaskMatrixCsv(
        [
          {
            key: "speaker:task",
            speakerId: "speaker",
            speakerName: "=Ada Lovelace",
            speakerEmail: "+ada@example.test",
            taskId: "task",
            taskTitle: "Review biography",
            assignmentId: "assignment",
            assignmentStatus: "PENDING",
            state: "outstanding",
            dueAt: new Date("2027-03-14T07:59:59.000Z"),
            completedAt: null,
          },
        ],
        "America/Los_Angeles",
      ),
    );
    assert.match(csv, /^"speakerId","speaker","email","taskId","task","state"/);
    assert.match(csv, /"'=Ada Lovelace","'\+ada@example\.test"/);
    assert.match(csv, /"2027-03-13"/);
  });

  test("handles empty events and a representative large matrix", async () => {
    const emptyEvent = await createEvent("empty-matrix");
    const empty = await repository.list(emptyEvent.id, emptyEvent.timezone);
    assert.equal(empty.rows.length, 0);
    assert.deepEqual(empty.speakers, []);
    assert.deepEqual(empty.tasks, []);

    const largeEvent = await createEvent("large-matrix");
    for (let taskIndex = 0; taskIndex < 10; taskIndex += 1) {
      await client.speakerTaskDefinition.create({
        data: {
          eventId: largeEvent.id,
          key: `task-${taskIndex}`,
          versions: {
            create: {
              versionNumber: 1,
              sortOrder: taskIndex,
              title: `Task ${taskIndex}`,
              applicability: {},
            },
          },
        },
      });
    }
    for (let speakerIndex = 0; speakerIndex < 20; speakerIndex += 1) {
      await createSpeaker(largeEvent.id, `speaker-${speakerIndex}@example.test`, "CONFIRMED");
    }
    const large = await repository.list(largeEvent.id, largeEvent.timezone);
    assert.equal(large.speakers.length, 20);
    assert.equal(large.tasks.length, 10);
    assert.equal(large.rows.length, 200);
    assert.equal(large.counts.outstanding, 200);
  });
});
