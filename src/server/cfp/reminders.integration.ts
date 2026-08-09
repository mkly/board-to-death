import { PrismaPg } from "@prisma/adapter-pg";

import { CfpDraftPolicy, EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { createDeterministicInfrastructure } from "../infrastructure/index.ts";
import { CfpDraftRepository } from "./drafts.ts";
import { runCfpDraftReminderWorker } from "./reminders.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for CFP reminder integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const OPEN_AT = new Date("2027-01-01T08:00:00.000Z");
const CLOSE_AT = new Date("2027-01-13T08:00:00.000Z");
const OCCURRENCE_AT = new Date("2027-01-10T17:00:00.000Z");

interface FixtureOptions {
  readonly draftPolicy?: CfpDraftPolicy;
  readonly remindersEnabled?: boolean;
  readonly daysBeforeClose?: number;
}

async function createFixture(key: string, options: FixtureOptions = {}) {
  const event = await client.event.create({
    data: {
      name: `Event ${key}`,
      slug: `event-${key}`,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-15T00:00:00.000Z"),
    },
  });
  const form = await client.cfpForm.create({
    data: {
      eventId: event.id,
      key: "main-cfp",
      versions: {
        create: { versionNumber: 1, schemaVersion: 1, title: "Main CFP", customTypes: {} },
      },
    },
    include: { versions: true },
  });
  const formVersion = form.versions[0];
  assert.ok(formVersion);
  const policy = await client.cfpPolicy.create({
    data: {
      eventId: event.id,
      key: "main-cfp",
      status: "PUBLISHED",
      publishedFormVersionId: formVersion.id,
    },
  });
  await client.cfpPolicyVersion.create({
    data: {
      eventId: event.id,
      policyId: policy.id,
      versionNumber: 1,
      submissionOpensAt: OPEN_AT,
      submissionClosesAt: CLOSE_AT,
      draftPolicy: options.draftPolicy ?? CfpDraftPolicy.ALLOWED,
      submissionLimits: { maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 },
      messages: {
        introduction: "Welcome",
        submissionConfirmation: "Submitted",
        closed: "Closed",
        reminder: {
          enabled: options.remindersEnabled ?? true,
          daysBeforeClose: options.daysBeforeClose ?? 3,
          sendAtMinute: 9 * 60,
        },
      },
      conditionalVisibility: [],
    },
  });
  return { event, formVersion, policy };
}

async function createDraft(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  email: string,
  clock: { now(): Date },
) {
  const repository = new CfpDraftRepository({ database: client, clock });
  const saved = await repository.save({
    eventId: fixture.event.id,
    policyId: fixture.policy.id,
    draftPolicy: CfpDraftPolicy.ALLOWED,
    formVersionId: fixture.formVersion.id,
    answers: { abstract: "unfinished" },
    participants: [{ email, givenName: email.split("@")[0], familyName: "Applicant" }],
    categoryKeys: [],
  });
  const draft = await client.cfpSubmissionDraft.findFirstOrThrow({
    where: { eventId: fixture.event.id, policyId: fixture.policy.id },
  });
  return { repository, saved, draft };
}

function worker(now: string) {
  const infrastructure = createDeterministicInfrastructure({ repositories: {}, now });
  return {
    infrastructure,
    run: () =>
      runCfpDraftReminderWorker({
        client,
        email: infrastructure.email,
        clock: infrastructure.clock,
        providerName: "deterministic-email",
        publicAppUrl: "https://events.example.test",
        defaultRetryDelayMs: 60_000,
      }),
  };
}

describe("CFP draft reminders", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("selects only live opted-in drafts at the configured event-local boundary", async () => {
    const { infrastructure, run } = worker("2027-01-10T16:59:59.999Z");
    const eligible = await createFixture("eligible");
    await createDraft(eligible, "eligible@example.test", infrastructure.clock);

    const optedOut = await createFixture("opted-out");
    const optedOutDraft = await createDraft(optedOut, "opted-out@example.test", infrastructure.clock);
    await optedOutDraft.repository.setReminderOptOut({
      eventId: optedOut.event.id,
      policyId: optedOut.policy.id,
      token: optedOutDraft.saved.token,
      optedOut: true,
    });

    const expired = await createFixture("expired");
    const expiredDraft = await createDraft(expired, "expired@example.test", infrastructure.clock);
    await client.cfpSubmissionDraft.update({ where: { id: expiredDraft.draft.id }, data: { expiresAt: OCCURRENCE_AT } });

    const closed = await createFixture("closed");
    await createDraft(closed, "closed@example.test", infrastructure.clock);
    await client.cfpPolicy.update({ where: { id: closed.policy.id }, data: { status: "CLOSED" } });

    const disabled = await createFixture("disabled", { draftPolicy: CfpDraftPolicy.DISABLED });
    await createDraft(disabled, "disabled@example.test", infrastructure.clock);

    const remindersDisabled = await createFixture("reminders-disabled", { remindersEnabled: false });
    await createDraft(remindersDisabled, "reminders-disabled@example.test", infrastructure.clock);

    const finalized = await createFixture("finalized");
    const finalizedDraft = await createDraft(finalized, "finalized@example.test", infrastructure.clock);
    await finalizedDraft.repository.discard({
      eventId: finalized.event.id,
      policyId: finalized.policy.id,
      token: finalizedDraft.saved.token,
    });

    assert.equal((await run()).deliveries, 0);
    infrastructure.clock.advanceBy(1);
    assert.deepEqual(await run(), {
      occurrencesCreated: 1,
      deliveries: 1,
      retriesScheduled: 0,
      terminalFailures: 0,
      skipped: 0,
    });
    assert.equal(infrastructure.email.sentMessages[0]?.to[0]?.address, "eligible@example.test");
    assert.equal(await client.messageDelivery.count(), 1);
  });

  test("audits provider failure, retries when due, and suppresses repeated and concurrent sends", async () => {
    const { infrastructure, run } = worker(OCCURRENCE_AT.toISOString());
    const fixture = await createFixture("retry");
    await createDraft(fixture, "retry@example.test", infrastructure.clock);
    infrastructure.email.failNext("rate-limited", 60_000);

    assert.equal((await run()).retriesScheduled, 1);
    assert.equal((await run()).skipped, 1);
    infrastructure.clock.advanceBy(60_000);
    const concurrent = await Promise.all([run(), run()]);
    assert.equal(
      concurrent.reduce((count, result) => count + result.deliveries, 0),
      1,
    );
    assert.equal(infrastructure.email.sentMessages.length, 1);
    assert.deepEqual(await run(), {
      occurrencesCreated: 0,
      deliveries: 0,
      retriesScheduled: 0,
      terminalFailures: 0,
      skipped: 0,
    });
    assert.equal(await client.messageDelivery.count(), 1);
    assert.equal(await client.deliveryAttempt.count(), 2);
  });

  test("uses the latest saved policy timing without creating a second occurrence after policy changes", async () => {
    const { infrastructure, run } = worker(OCCURRENCE_AT.toISOString());
    const fixture = await createFixture("policy-change", { daysBeforeClose: 4 });
    await createDraft(fixture, "policy-change@example.test", infrastructure.clock);
    const baseVersion = await client.cfpPolicyVersion.findFirstOrThrow({ where: { policyId: fixture.policy.id } });
    const messages = baseVersion.messages as Record<string, unknown>;
    await client.cfpPolicyVersion.create({
      data: {
        eventId: fixture.event.id,
        policyId: fixture.policy.id,
        versionNumber: 2,
        submissionOpensAt: OPEN_AT,
        submissionClosesAt: CLOSE_AT,
        draftPolicy: CfpDraftPolicy.REQUIRED,
        submissionLimits: { maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 },
        messages: { ...messages, reminder: { enabled: true, daysBeforeClose: 2, sendAtMinute: 9 * 60 } },
        conditionalVisibility: [],
      },
    });

    assert.equal((await run()).deliveries, 0);
    infrastructure.clock.advanceBy(24 * 60 * 60 * 1000);
    assert.equal((await run()).deliveries, 1);
    await client.cfpPolicyVersion.create({
      data: {
        eventId: fixture.event.id,
        policyId: fixture.policy.id,
        versionNumber: 3,
        submissionOpensAt: OPEN_AT,
        submissionClosesAt: CLOSE_AT,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        submissionLimits: { maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 },
        messages: { ...messages, reminder: { enabled: true, daysBeforeClose: 1, sendAtMinute: 9 * 60 } },
        conditionalVisibility: [],
      },
    });
    infrastructure.clock.advanceBy(24 * 60 * 60 * 1000);

    assert.deepEqual(await run(), {
      occurrencesCreated: 0,
      deliveries: 0,
      retriesScheduled: 0,
      terminalFailures: 0,
      skipped: 0,
    });
    assert.equal(infrastructure.email.sentMessages.length, 1);
    assert.equal(await client.messageDelivery.count(), 1);
  });
});
