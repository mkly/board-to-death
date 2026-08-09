import {
  magicLinkRequestUrl,
  startMagicLinkWebhook,
  stopMagicLinkWebhook,
} from "./browser/fixtures/magic-link-webhook.ts";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";

const servers = new Set<Server>();

async function startBroker(options: { deliveryTimeoutMs?: number; path?: string } = {}): Promise<URL> {
  const server = await startMagicLinkWebhook({
    webhookUrl: new URL(`http://127.0.0.1:0${options.path ?? ""}`),
    deliveryTimeoutMs: options.deliveryTimeoutMs,
  });
  servers.add(server);
  const { port } = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}${options.path ?? ""}`);
}

function deliver(brokerUrl: URL, link: string): Promise<Response> {
  return fetch(brokerUrl, { method: "POST", body: JSON.stringify({ text: `Sign in at ${link}` }) });
}

afterEach(async () => {
  await Promise.all([...servers].map(stopMagicLinkWebhook));
  servers.clear();
});

test("delivers each magic link to the browser spec that requested it", async () => {
  const brokerUrl = await startBroker();
  const first = magicLinkRequestUrl("first-spec", brokerUrl);
  const second = magicLinkRequestUrl("second-spec", brokerUrl);

  assert.equal((await fetch(first, { method: "POST" })).status, 204);
  // A queued registration is answered immediately rather than left on the wire
  // until its turn comes up.
  assert.equal((await fetch(second, { method: "POST" })).status, 204);

  const firstDelivery = fetch(first);
  const secondDelivery = fetch(second);

  assert.equal((await deliver(brokerUrl, "https://app.example.test/first-link")).status, 204);
  assert.equal((await deliver(brokerUrl, "https://app.example.test/second-link")).status, 204);

  assert.deepEqual(await (await firstDelivery).json(), { url: "https://app.example.test/first-link" });
  assert.deepEqual(await (await secondDelivery).json(), { url: "https://app.example.test/second-link" });
});

test("a spec that never receives a magic link fails on its own bounded wait without blocking the queue", async () => {
  const brokerUrl = await startBroker({ deliveryTimeoutMs: 150 });
  const abandoned = magicLinkRequestUrl("abandoned-spec", brokerUrl);
  const queued = magicLinkRequestUrl("queued-spec", brokerUrl);

  assert.equal((await fetch(abandoned, { method: "POST" })).status, 204);
  assert.equal((await fetch(queued, { method: "POST" })).status, 204);

  const abandonedDelivery = fetch(abandoned);
  const queuedDelivery = fetch(queued);

  // The first turn expires on its own deadline...
  const timedOut = await abandonedDelivery;
  assert.equal(timedOut.status, 504);

  // ...and the queued spec then gets the very next delivery.
  assert.equal((await deliver(brokerUrl, "https://app.example.test/queued-link")).status, 204);
  assert.deepEqual(await (await queuedDelivery).json(), { url: "https://app.example.test/queued-link" });
});

test("accepts a delivery on whatever path AUTH_MAGIC_LINK_WEBHOOK_URL carries", async () => {
  for (const path of ["", "/magic-link"]) {
    const brokerUrl = await startBroker({ path });
    const requestUrl = magicLinkRequestUrl("path-spec", brokerUrl);

    assert.equal((await fetch(requestUrl, { method: "POST" })).status, 204);
    const delivery = fetch(requestUrl);
    assert.equal((await deliver(brokerUrl, `https://app.example.test/link${path}`)).status, 204);
    assert.deepEqual(await (await delivery).json(), { url: `https://app.example.test/link${path}` });
  }
});

test("cancelling a request hands the turn to the next queued spec", async () => {
  const brokerUrl = await startBroker();
  const cancelled = magicLinkRequestUrl("cancelled-spec", brokerUrl);
  const queued = magicLinkRequestUrl("queued-spec", brokerUrl);

  assert.equal((await fetch(cancelled, { method: "POST" })).status, 204);
  assert.equal((await fetch(queued, { method: "POST" })).status, 204);
  const queuedDelivery = fetch(queued);

  assert.equal((await fetch(cancelled, { method: "DELETE" })).status, 204);

  assert.equal((await deliver(brokerUrl, "https://app.example.test/after-cancel")).status, 204);
  assert.deepEqual(await (await queuedDelivery).json(), { url: "https://app.example.test/after-cancel" });
});

test("rejects a delivery when no spec holds a turn", async () => {
  const brokerUrl = await startBroker();
  assert.equal((await deliver(brokerUrl, "https://app.example.test/orphan")).status, 409);
});
