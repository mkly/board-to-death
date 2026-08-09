import { type Prisma, type PrismaClient, WebhookDeliveryStatus } from "../../generated/prisma/client.ts";
import type { WebhookEventType } from "./contracts.ts";
import { createHmac, randomBytes } from "node:crypto";

export { type WebhookEventType, webhookEventTypes } from "./contracts.ts";

const retryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000] as const;

function endpointEvents(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((event): event is string => typeof event === "string") : [];
}

export function webhookSignature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function registerWebhookEndpoint(
  client: PrismaClient,
  input: {
    readonly eventId: string;
    readonly name: string;
    readonly url: string;
    readonly events: readonly WebhookEventType[];
  },
) {
  return client.webhookEndpoint.create({
    data: {
      ...input,
      events: [...new Set(input.events)],
      signingSecret: `whsec_${randomBytes(24).toString("base64url")}`,
    },
  });
}

export async function disableWebhookEndpoint(
  client: PrismaClient,
  eventId: string,
  endpointId: string,
): Promise<boolean> {
  const result = await client.webhookEndpoint.updateMany({
    where: { id: endpointId, eventId, disabledAt: null },
    data: { disabledAt: new Date() },
  });
  return result.count === 1;
}

async function attemptDelivery(
  client: PrismaClient,
  deliveryId: string,
  fetcher: typeof fetch,
  now: Date,
): Promise<void> {
  const delivery = await client.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery || delivery.endpoint.disabledAt) return;
  const body = JSON.stringify({
    id: delivery.id,
    event: delivery.eventType,
    createdAt: delivery.createdAt,
    data: delivery.payload,
  });
  const attemptCount = delivery.attemptCount + 1;
  let responseStatus: number | null = null;
  try {
    const response = await fetcher(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-board-to-death-event": delivery.eventType,
        "x-board-to-death-signature": webhookSignature(delivery.endpoint.signingSecret, body),
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    responseStatus = response.status;
    if (response.ok) {
      await client.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.DELIVERED,
          attemptCount,
          responseStatus: response.status,
          deliveredAt: now,
          nextAttemptAt: null,
          error: null,
        },
      });
      return;
    }
    throw new Error(`Endpoint returned HTTP ${response.status}.`);
  } catch (error) {
    const delay = retryDelaysMs[attemptCount - 1];
    await client.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: delay === undefined ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.RETRY_SCHEDULED,
        attemptCount,
        responseStatus,
        nextAttemptAt: delay === undefined ? null : new Date(now.getTime() + delay),
        error: error instanceof Error ? error.message : "Webhook delivery failed.",
      },
    });
  }
}

export async function emitWebhookEvent(
  client: PrismaClient,
  input: { readonly eventId: string; readonly type: WebhookEventType; readonly data: Prisma.InputJsonValue },
  options: { readonly fetcher?: typeof fetch; readonly now?: Date } = {},
): Promise<void> {
  const endpoints = await client.webhookEndpoint.findMany({ where: { eventId: input.eventId, disabledAt: null } });
  const subscribed = endpoints.filter((endpoint) => endpointEvents(endpoint.events).includes(input.type));
  if (subscribed.length === 0) return;
  const deliveries = await client.$transaction(
    subscribed.map((endpoint) =>
      client.webhookDelivery.create({
        data: { eventId: input.eventId, endpointId: endpoint.id, eventType: input.type, payload: input.data },
      }),
    ),
  );
  await Promise.all(
    deliveries.map((delivery) =>
      attemptDelivery(client, delivery.id, options.fetcher ?? fetch, options.now ?? new Date()),
    ),
  );
}

export async function processDueWebhookDeliveries(
  client: PrismaClient,
  options: { readonly eventId?: string; readonly fetcher?: typeof fetch; readonly now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const deliveries = await client.webhookDelivery.findMany({
    where: {
      ...(options.eventId ? { eventId: options.eventId } : {}),
      status: WebhookDeliveryStatus.RETRY_SCHEDULED,
      nextAttemptAt: { lte: now },
    },
    select: { id: true },
    take: 100,
  });
  await Promise.all(deliveries.map(({ id }) => attemptDelivery(client, id, options.fetcher ?? fetch, now)));
  return deliveries.length;
}
