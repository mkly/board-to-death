import { PrismaPg } from "@prisma/adapter-pg";

import {
  DeliveryAttemptStatus,
  DeliveryFailureClass,
  EventType,
  MessageRecipientStatus,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for communication persistence integration tests.");
}

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createEvent(slug = "board-to-death-2027") {
  return client.event.create({
    data: {
      name: "Board to Death 2027",
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-15T00:00:00.000Z"),
    },
  });
}

async function createTemplateVersion(eventId: string) {
  return client.communicationTemplate.create({
    data: {
      eventId,
      key: "speaker-reminder",
      name: "Speaker reminder",
      versions: {
        create: {
          version: 1,
          subjectTemplate: "Reminder for {{ event.name }}",
          htmlTemplate: "<p>Hello {{ speaker.name }}</p>",
          textTemplate: "Hello {{ speaker.name }}",
        },
      },
    },
    include: { versions: true },
  });
}

describe("communication persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("keeps template edits as ordered, event-scoped versions", async () => {
    const event = await createEvent();
    const otherEvent = await createEvent("another-event");
    const template = await createTemplateVersion(event.id);

    await client.communicationTemplate.update({
      where: { id: template.id },
      data: {
        name: "Speaker deadline reminder",
        versions: {
          create: {
            version: 2,
            subjectTemplate: "Action required for {{ event.name }}",
            htmlTemplate: "<p>Please finish your profile, {{ speaker.name }}.</p>",
            textTemplate: "Please finish your profile, {{ speaker.name }}.",
          },
        },
      },
    });

    const versions = await client.communicationTemplateVersion.findMany({
      where: { templateId: template.id },
      orderBy: { version: "asc" },
    });
    assert.deepEqual(
      versions.map(({ version, subjectTemplate }) => [version, subjectTemplate]),
      [
        [1, "Reminder for {{ event.name }}"],
        [2, "Action required for {{ event.name }}"],
      ],
    );

    await assert.rejects(
      client.communicationTemplateVersion.create({
        data: {
          templateId: template.id,
          eventId: event.id,
          version: 2,
          subjectTemplate: "Duplicate version",
          htmlTemplate: "<p>Duplicate</p>",
        },
      }),
    );
    await client.communicationTemplate.create({
      data: { eventId: otherEvent.id, key: template.key, name: template.name },
    });
  });

  test("stores immutable rendered recipient snapshots and rejects duplicate bulk or reminder sends", async () => {
    const event = await createEvent();
    const template = await createTemplateVersion(event.id);
    const templateVersion = template.versions[0];
    assert.ok(templateVersion);

    const delivery = await client.messageDelivery.create({
      data: {
        eventId: event.id,
        templateVersionId: templateVersion.id,
        idempotencyKey: "bulk:accepted-speakers:2027-02-01",
        occurrenceKey: "speaker-reminder:2027-02-01T17:00:00Z",
        scheduledFor: new Date("2027-02-01T17:00:00.000Z"),
        recipients: {
          create: [
            {
              recipientKey: "speaker:ada",
              email: "ada@example.test",
              displayName: "Ada Lovelace",
              subjectSnapshot: "Reminder for Board to Death 2027",
              htmlSnapshot: "<p>Hello Ada Lovelace</p>",
              textSnapshot: "Hello Ada Lovelace",
            },
            {
              recipientKey: "speaker:grace",
              email: "grace@example.test",
              displayName: "Grace Hopper",
              subjectSnapshot: "Reminder for Board to Death 2027",
              htmlSnapshot: "<p>Hello Grace Hopper</p>",
              textSnapshot: "Hello Grace Hopper",
            },
          ],
        },
      },
      include: { recipients: { orderBy: { recipientKey: "asc" } } },
    });

    assert.equal(delivery.recipients.length, 2);
    assert.equal(delivery.recipients[0]?.status, MessageRecipientStatus.QUEUED);
    assert.equal(delivery.recipients[0]?.htmlSnapshot, "<p>Hello Ada Lovelace</p>");

    await assert.rejects(
      client.messageDelivery.create({
        data: {
          eventId: event.id,
          templateVersionId: templateVersion.id,
          idempotencyKey: delivery.idempotencyKey,
        },
      }),
    );
    await assert.rejects(
      client.messageDelivery.create({
        data: {
          eventId: event.id,
          templateVersionId: templateVersion.id,
          idempotencyKey: "another-worker-attempt",
          occurrenceKey: delivery.occurrenceKey,
        },
      }),
    );

    const otherEvent = await createEvent("another-event");
    await assert.rejects(
      client.messageDelivery.create({
        data: {
          eventId: otherEvent.id,
          templateVersionId: templateVersion.id,
          idempotencyKey: "cross-event-template",
        },
      }),
    );
  });

  test("records transient retries, provider success, and terminal permanent failure", async () => {
    const event = await createEvent();
    const template = await createTemplateVersion(event.id);
    const templateVersion = template.versions[0];
    assert.ok(templateVersion);
    const delivery = await client.messageDelivery.create({
      data: {
        eventId: event.id,
        templateVersionId: templateVersion.id,
        idempotencyKey: "delivery-lifecycle",
      },
    });
    const retryingRecipient = await client.messageRecipient.create({
      data: {
        deliveryId: delivery.id,
        recipientKey: "speaker:ada",
        email: "ada@example.test",
        subjectSnapshot: "Reminder",
        htmlSnapshot: "<p>Reminder</p>",
      },
    });
    const failedAt = new Date("2027-02-01T17:00:05.000Z");
    const retryAt = new Date("2027-02-01T17:05:05.000Z");

    await client.deliveryAttempt.create({
      data: {
        recipientId: retryingRecipient.id,
        attemptNumber: 1,
        provider: "fake-mail",
        status: DeliveryAttemptStatus.FAILED,
        failureClass: DeliveryFailureClass.TRANSIENT,
        failureCode: "rate_limited",
        failureMessage: "Retry later",
        completedAt: failedAt,
      },
    });
    await client.messageRecipient.update({
      where: { id: retryingRecipient.id },
      data: { status: MessageRecipientStatus.RETRY_SCHEDULED, nextAttemptAt: retryAt },
    });

    const succeededAt = new Date("2027-02-01T17:05:06.000Z");
    await client.deliveryAttempt.create({
      data: {
        recipientId: retryingRecipient.id,
        attemptNumber: 2,
        provider: "fake-mail",
        providerMessageId: "provider-message-123",
        status: DeliveryAttemptStatus.SUCCEEDED,
        completedAt: succeededAt,
      },
    });
    const delivered = await client.messageRecipient.update({
      where: { id: retryingRecipient.id },
      data: {
        status: MessageRecipientStatus.DELIVERED,
        nextAttemptAt: null,
        deliveredAt: succeededAt,
        terminalAt: succeededAt,
      },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
    });
    assert.deepEqual(
      delivered.attempts.map(({ status, failureClass }) => [status, failureClass]),
      [
        [DeliveryAttemptStatus.FAILED, DeliveryFailureClass.TRANSIENT],
        [DeliveryAttemptStatus.SUCCEEDED, null],
      ],
    );

    const permanentlyFailed = await client.messageRecipient.create({
      data: {
        deliveryId: delivery.id,
        recipientKey: "speaker:invalid",
        email: "invalid@example.test",
        subjectSnapshot: "Reminder",
        htmlSnapshot: "<p>Reminder</p>",
      },
    });
    await client.deliveryAttempt.create({
      data: {
        recipientId: permanentlyFailed.id,
        attemptNumber: 1,
        provider: "fake-mail",
        status: DeliveryAttemptStatus.FAILED,
        failureClass: DeliveryFailureClass.PERMANENT,
        failureCode: "invalid_recipient",
        completedAt: failedAt,
      },
    });
    const terminal = await client.messageRecipient.update({
      where: { id: permanentlyFailed.id },
      data: { status: MessageRecipientStatus.FAILED, terminalAt: failedAt },
    });
    assert.equal(terminal.status, MessageRecipientStatus.FAILED);

    await assert.rejects(
      client.messageRecipient.update({
        where: { id: terminal.id },
        data: { status: MessageRecipientStatus.DELIVERED, terminalAt: null },
      }),
    );
  });
});
