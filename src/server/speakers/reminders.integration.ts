import { PrismaPg } from "@prisma/adapter-pg";

import { CfpSubmissionStatus, EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { createDeterministicInfrastructure } from "../infrastructure/index.ts";
import { runOnboardingReminderWorker, SpeakerTaskReminderRepository } from "./reminders.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for onboarding reminder integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createEvent(slug: string) {
  const event = await client.event.create({
    data: {
      name: "Board to Death 2027",
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-16T00:00:00.000Z"),
    },
  });
  const template = await client.communicationTemplate.create({
    data: {
      eventId: event.id,
      key: "onboarding-reminder",
      name: "Onboarding reminder",
      versions: {
        create: {
          version: 1,
          subjectTemplate: "Reminder: {{onboarding.deadline}}",
          htmlTemplate: "Hello {{speaker.name}}, finish your task for **{{event.name}}**.",
          textTemplate: "Hello {{speaker.name}}, finish your task by {{onboarding.deadline}}.",
        },
      },
    },
  });
  return { event, template };
}

async function createCandidate(
  eventId: string,
  key: string,
  dueAt: Date,
  options: {
    readonly submissionStatus?: CfpSubmissionStatus;
    readonly assignmentStatus?: "PENDING" | "SUBMITTED" | "APPROVED" | "REVISION_REQUESTED" | "WITHDRAWN";
    readonly remindersOptedOut?: boolean;
  } = {},
) {
  const speaker = await client.speaker.create({
    data: {
      eventId,
      normalizedEmail: `${key}@example.test`,
      profileVersions: {
        create: {
          versionNumber: 1,
          email: `${key}@example.test`,
          givenName: key,
          familyName: "Speaker",
        },
      },
    },
  });
  const form = await client.cfpForm.create({
    data: {
      eventId,
      key: `form-${key}`,
      versions: { create: { versionNumber: 1, schemaVersion: 1, title: key, customTypes: {} } },
    },
    include: { versions: true },
  });
  const formVersion = form.versions[0];
  assert.ok(formVersion);
  const submissionStatus = options.submissionStatus ?? CfpSubmissionStatus.CONFIRMED;
  const submittedAt = new Date("2026-12-01T18:00:00.000Z");
  await client.cfpSubmission.create({
    data: {
      eventId,
      formVersionId: formVersion.id,
      kind: "ABSTRACT",
      status: submissionStatus,
      submittedAt,
      reviewStartedAt: submittedAt,
      decidedAt: submittedAt,
      confirmedAt: submissionStatus === CfpSubmissionStatus.CONFIRMED ? submittedAt : null,
      participants: { create: { speakerId: speaker.id, sortOrder: 0 } },
    },
  });
  const definition = await client.speakerTaskDefinition.create({
    data: {
      eventId,
      key: `task-${key}`,
      versions: {
        create: {
          versionNumber: 1,
          sortOrder: 0,
          title: `Task for ${key}`,
          applicability: { confirmedOnly: true },
        },
      },
    },
    include: { versions: true },
  });
  const definitionVersion = definition.versions[0];
  assert.ok(definitionVersion);
  const assignmentStatus = options.assignmentStatus ?? "PENDING";
  return client.speakerTaskAssignment.create({
    data: {
      eventId,
      definitionId: definition.id,
      definitionVersionId: definitionVersion.id,
      speakerId: speaker.id,
      dueAt,
      status: assignmentStatus,
      submittedAt: ["SUBMITTED", "REVISION_REQUESTED", "APPROVED"].includes(assignmentStatus) ? submittedAt : null,
      completedAt: assignmentStatus === "APPROVED" ? submittedAt : null,
      withdrawnAt: assignmentStatus === "WITHDRAWN" ? submittedAt : null,
      remindersOptedOut: options.remindersOptedOut ?? false,
    },
  });
}

function worker(now: string) {
  const infrastructure = createDeterministicInfrastructure({ repositories: {}, now });
  return {
    infrastructure,
    run: () =>
      runOnboardingReminderWorker({
        client,
        email: infrastructure.email,
        clock: infrastructure.clock,
        providerName: "deterministic-email",
        defaultRetryDelayMs: 60_000,
      }),
  };
}

describe("speaker onboarding reminders", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("uses local calendar dates across daylight saving and sends one occurrence after an early run", async () => {
    const { event, template } = await createEvent("dst-reminders");
    await createCandidate(event.id, "ada", new Date("2027-03-16T06:59:59.000Z"));
    const { infrastructure, run } = worker("2027-03-13T16:59:00.000Z");
    const repository = new SpeakerTaskReminderRepository(client, () => infrastructure.clock.now());
    const rule = await repository.create({
      eventId: event.id,
      templateId: template.id,
      name: "Two days before",
      daysBeforeDue: 2,
      sendAtMinute: 9 * 60,
    });
    await repository.activate(event.id, rule.id);

    assert.deepEqual(await run(), {
      occurrencesCreated: 0,
      deliveries: 0,
      retriesScheduled: 0,
      terminalFailures: 0,
      skipped: 0,
    });
    infrastructure.clock.advanceBy(61_000);
    const concurrent = await Promise.all([run(), run()]);

    assert.equal(
      concurrent.reduce((count, result) => count + result.deliveries, 0),
      1,
    );
    assert.equal(infrastructure.email.sentMessages.length, 1);
    const delivery = await client.messageDelivery.findFirstOrThrow({ where: { eventId: event.id } });
    assert.deepEqual(delivery.scheduledFor, new Date("2027-03-13T17:00:00.000Z"));
    assert.equal(await client.deliveryAttempt.count(), 1);
  });

  test("retries late occurrences, applies rule edits, and stops cancelled rules", async () => {
    const { event, template } = await createEvent("rule-lifecycle");
    await createCandidate(event.id, "grace", new Date("2027-01-11T07:59:59.000Z"));
    const { infrastructure, run } = worker("2027-01-01T18:00:00.000Z");
    const repository = new SpeakerTaskReminderRepository(client, () => infrastructure.clock.now());
    const rule = await repository.create({
      eventId: event.id,
      templateId: template.id,
      name: "Ten days before",
      daysBeforeDue: 10,
      sendAtMinute: 9 * 60,
    });
    await repository.activate(event.id, rule.id);
    infrastructure.email.failNext("rate-limited", 60_000);

    assert.equal((await run()).retriesScheduled, 1);
    assert.equal((await run()).skipped, 1);
    infrastructure.clock.advanceBy(60_000);
    assert.equal((await run()).deliveries, 1);

    await repository.update({
      eventId: event.id,
      ruleId: rule.id,
      templateId: template.id,
      name: "Nine days before",
      daysBeforeDue: 9,
      sendAtMinute: 9 * 60,
    });
    assert.equal((await run()).deliveries, 1);
    await repository.cancel(event.id, rule.id);
    await createCandidate(event.id, "cancelled", new Date("2027-01-11T07:59:59.000Z"));
    assert.deepEqual(await run(), {
      occurrencesCreated: 0,
      deliveries: 0,
      retriesScheduled: 0,
      terminalFailures: 0,
      skipped: 0,
    });
  });

  test("skips completed, withdrawn, ineligible, and opted-out assignments", async () => {
    const { event, template } = await createEvent("eligibility");
    const dueAt = new Date("2027-01-02T07:59:59.000Z");
    await createCandidate(event.id, "eligible", dueAt);
    await createCandidate(event.id, "completed", dueAt, { assignmentStatus: "APPROVED" });
    await createCandidate(event.id, "withdrawn", dueAt, { assignmentStatus: "WITHDRAWN" });
    await createCandidate(event.id, "ineligible", dueAt, { submissionStatus: "REJECTED" });
    await createCandidate(event.id, "opted-out", dueAt, { remindersOptedOut: true });
    const { infrastructure, run } = worker("2027-01-02T18:00:00.000Z");
    const repository = new SpeakerTaskReminderRepository(client, () => infrastructure.clock.now());
    const rule = await repository.create({
      eventId: event.id,
      templateId: template.id,
      name: "Due today",
      daysBeforeDue: 0,
      sendAtMinute: 9 * 60,
    });
    assert.equal((await repository.previewEligibleAssignments(event.id)).length, 1);
    await repository.activate(event.id, rule.id);

    assert.equal((await run()).deliveries, 1);
    assert.equal(infrastructure.email.sentMessages[0]?.to[0]?.address, "eligible@example.test");
    assert.equal(await client.messageDelivery.count(), 1);
  });
});
