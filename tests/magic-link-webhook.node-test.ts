import { startMagicLinkWebhook } from "./browser/fixtures/magic-link-webhook.ts";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";

const servers = new Set<Awaited<ReturnType<typeof startMagicLinkWebhook>>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  servers.clear();
});

test("delivers each magic link to the browser spec that requested it", async () => {
  const server = await startMagicLinkWebhook(new URL("http://127.0.0.1:0/magic-link"));
  servers.add(server);
  const { port } = server.address() as AddressInfo;
  const brokerUrl = new URL(`http://127.0.0.1:${port}`);
  const firstRequestUrl = new URL("/magic-link/requests/first-spec", brokerUrl);
  const secondRequestUrl = new URL("/magic-link/requests/second-spec", brokerUrl);

  assert.equal((await fetch(firstRequestUrl, { method: "POST" })).status, 204);
  const firstDelivery = fetch(firstRequestUrl);
  const secondRegistration = fetch(secondRequestUrl, { method: "POST" });

  assert.equal(
    (
      await fetch(new URL("/magic-link", brokerUrl), {
        method: "POST",
        body: JSON.stringify({ text: "Sign in at https://app.example.test/first-link" }),
      })
    ).status,
    204,
  );
  assert.equal((await secondRegistration).status, 204);

  const secondDelivery = fetch(secondRequestUrl);
  assert.equal(
    (
      await fetch(new URL("/magic-link", brokerUrl), {
        method: "POST",
        body: JSON.stringify({ text: "Sign in at https://app.example.test/second-link" }),
      })
    ).status,
    204,
  );

  assert.deepEqual(await (await firstDelivery).json(), { url: "https://app.example.test/first-link" });
  assert.deepEqual(await (await secondDelivery).json(), { url: "https://app.example.test/second-link" });
});
