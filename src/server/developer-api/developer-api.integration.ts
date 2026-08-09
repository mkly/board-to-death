import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient, WebhookDeliveryStatus } from "../../generated/prisma/client.ts";
import { ApiTokenService, handlePrivateApiRequest } from "./index.ts";
import {
  emitWebhookEvent,
  processDueWebhookDeliveries,
  registerWebhookEndpoint,
  webhookSignature,
} from "./webhooks.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for developer API integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: slug,
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-15T00:00:00.000Z"),
    },
  });
}

describe("developer API tokens and webhooks", () => {
  before(async () => client.$connect());
  beforeEach(async () => client.event.deleteMany());
  after(async () => client.$disconnect());

  test("issues hashed scoped tokens and rejects missing, cross-event, and revoked access", async () => {
    const [event, otherEvent] = await Promise.all([createEvent("api-event"), createEvent("other-event")]);
    const service = new ApiTokenService(client);
    const issued = await service.issue(event.id, "Website", ["sessions:read"]);
    const stored = await client.apiToken.findUniqueOrThrow({ where: { id: issued.token.id } });
    assert.notEqual(stored.secretHash, issued.secret);
    assert.equal(stored.secretHash.includes(issued.secret), false);

    const missing = await handlePrivateApiRequest(new Request("https://example.test"), client, event.id, "sessions");
    assert.equal(missing.status, 401);
    const authorized = await handlePrivateApiRequest(
      new Request("https://example.test", { headers: { authorization: `Bearer ${issued.secret}` } }),
      client,
      event.id,
      "sessions",
    );
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { data: [] });
    const crossEvent = await handlePrivateApiRequest(
      new Request("https://example.test", { headers: { authorization: `Bearer ${issued.secret}` } }),
      client,
      otherEvent.id,
      "sessions",
    );
    assert.equal(crossEvent.status, 403);
    await service.revoke(event.id, issued.token.id);
    const revoked = await handlePrivateApiRequest(
      new Request("https://example.test", { headers: { authorization: `Bearer ${issued.secret}` } }),
      client,
      event.id,
      "sessions",
    );
    assert.equal(revoked.status, 403);
  });

  test("signs event-scoped payloads, schedules backoff, retries, and records the delivery log", async () => {
    const [event, otherEvent] = await Promise.all([createEvent("webhook-event"), createEvent("isolated-event")]);
    const endpoint = await registerWebhookEndpoint(client, {
      eventId: event.id,
      name: "Automation",
      url: "https://hooks.example.test/events",
      events: ["submission.created"],
    });
    await registerWebhookEndpoint(client, {
      eventId: otherEvent.id,
      name: "Other automation",
      url: "https://other.example.test/events",
      events: ["submission.created"],
    });
    const firstAttemptAt = new Date("2027-01-01T00:00:00.000Z");
    let requestBody = "";
    let signature = "";
    await emitWebhookEvent(
      client,
      { eventId: event.id, type: "submission.created", data: { submissionId: "submission-1" } },
      {
        now: firstAttemptAt,
        fetcher: async (_input, init) => {
          requestBody = String(init?.body);
          signature = new Headers(init?.headers).get("x-board-to-death-signature") ?? "";
          return new Response(null, { status: 503 });
        },
      },
    );
    assert.equal(signature, webhookSignature(endpoint.signingSecret, requestBody));
    let delivery = await client.webhookDelivery.findFirstOrThrow({ where: { eventId: event.id } });
    assert.equal(delivery.status, WebhookDeliveryStatus.RETRY_SCHEDULED);
    assert.equal(delivery.attemptCount, 1);
    assert.equal(delivery.responseStatus, 503);
    assert.equal(delivery.nextAttemptAt?.toISOString(), "2027-01-01T00:01:00.000Z");
    assert.equal(await client.webhookDelivery.count({ where: { eventId: otherEvent.id } }), 0);

    const processed = await processDueWebhookDeliveries(client, {
      now: new Date("2027-01-01T00:01:01.000Z"),
      fetcher: async () => new Response(null, { status: 204 }),
    });
    assert.equal(processed, 1);
    delivery = await client.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    assert.equal(delivery.status, WebhookDeliveryStatus.DELIVERED);
    assert.equal(delivery.attemptCount, 2);
    assert.equal(delivery.responseStatus, 204);
    assert.equal(delivery.error, null);
    assert.equal(delivery.deliveredAt?.toISOString(), "2027-01-01T00:01:01.000Z");
  });
});
