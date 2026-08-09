import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { CfpSubmissionStatus, PrismaClient } from "../../generated/prisma/client.ts";
import { BulkCommunicationRepository, BulkDeliveryDispatcher } from "../communications/bulk-dispatch.ts";
import { createDeterministicInfrastructure } from "../infrastructure/index.ts";
import { CfpFormRepository } from "./repositories.ts";
import { CfpSubmissionRepository } from "./submissions.ts";
import { CfpThankYouRepository } from "./thank-you.ts";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for CFP thank-you integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createFixture() {
  const event = await client.event.create({
    data: {
      name: "Board to Death 2027",
      slug: `cfp-thank-you-test-${randomUUID()}`,
      timezone: "America/Los_Angeles",
      location: "Oakland, California",
      startsAt: new Date("2027-05-10T16:00:00.000Z"),
      endsAt: new Date("2027-05-12T00:00:00.000Z"),
    },
  });
  const form = await new CfpFormRepository(client).create({
    eventId: event.id,
    key: "main-cfp",
    definition: {
      version: 1,
      title: "Share your session",
      sections: [
        {
          id: "proposal",
          kind: "questions",
          title: "Proposal",
          questions: [{ id: "email", type: "email", label: "Email", required: true }],
        },
      ],
    },
  });
  const formVersion = await client.cfpFormVersion.findUniqueOrThrow({
    where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
  });
  const submission = await new CfpSubmissionRepository(client).createFinalized({
    eventId: event.id,
    formVersionId: formVersion.id,
    kind: "ABSTRACT",
    idempotencyKey: randomUUID(),
    answers: [{ questionId: "email", value: "avery@example.test" }],
  });
  return { event, submission };
}

describe("CFP thank-you delivery", () => {
  beforeAll(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany({ where: { slug: { startsWith: "cfp-thank-you-test-" } } });
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  test("queues once and retries provider failure without changing the finalized submission", async () => {
    const { event, submission } = await createFixture();
    const repository = new CfpThankYouRepository(client);
    const input = {
      event,
      policyId: randomUUID(),
      policyVersionNumber: 3,
      submissionId: submission.id,
      recipient: { email: "avery@example.test", name: "Avery Chen" },
      bodyTemplate: "Thank you, **{{recipient.name}}**, for submitting to {{event.name}}.",
      portalUrl: `https://events.example.test/portal/${event.slug}/sign-in`,
    } as const;

    const first = await repository.queue(input);
    const replay = await repository.queue(input);
    expect(new Set([first.deliveryId, replay.deliveryId]).size).toBe(1);
    expect([first.duplicate, replay.duplicate].sort()).toEqual([false, true]);
    expect(await client.messageDelivery.count({ where: { eventId: event.id } })).toBe(1);
    expect(await client.messageRecipient.count({ where: { delivery: { eventId: event.id } } })).toBe(1);

    const infrastructure = createDeterministicInfrastructure({ repositories: {}, now: "2027-05-01T16:00:00.000Z" });
    infrastructure.email.failNext("unavailable", 1_000);
    const dispatcher = new BulkDeliveryDispatcher({
      client,
      provider: infrastructure.email,
      providerName: "local-cfp-email",
      clock: infrastructure.clock,
    });
    expect((await dispatcher.process(event.id, first.deliveryId))[0]?.status).toBe("retry-scheduled");
    expect((await client.cfpSubmission.findUniqueOrThrow({ where: { id: submission.id } })).status).toBe(
      CfpSubmissionStatus.SUBMITTED,
    );

    const duplicateAfterFailure = await repository.queue(input);
    expect(duplicateAfterFailure).toMatchObject({ deliveryId: first.deliveryId, duplicate: true });
    expect(await client.messageDelivery.count({ where: { eventId: event.id } })).toBe(1);

    infrastructure.clock.advanceBy(1_000);
    expect((await dispatcher.process(event.id, first.deliveryId))[0]?.status).toBe("delivered");
    expect((await dispatcher.process(event.id, first.deliveryId))[0]).toBeUndefined();
    expect(infrastructure.email.sentMessages).toHaveLength(1);
    expect(infrastructure.email.sentMessages[0]).toMatchObject({
      to: [{ address: "avery@example.test", name: "Avery Chen" }],
      subject: "Thank you for submitting to Board to Death 2027",
    });
    expect(infrastructure.email.sentMessages[0]?.text).toContain(
      `https://events.example.test/portal/${event.slug}/sign-in`,
    );

    const delivery = await new BulkCommunicationRepository(client).get(event.id, first.deliveryId);
    expect(delivery?.recipients[0]).toMatchObject({ status: "delivered", email: "avery@example.test" });
    expect(delivery?.recipients[0]?.attempts).toHaveLength(2);
  });
});
