import type { Page } from "@playwright/test";

import { grantSeededOrganizationAccess } from "./organization-access";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * A single magic-link webhook broker shared by every authenticated browser spec.
 *
 * Playwright runs spec files in parallel workers, so a per-spec listener on a
 * fixed port collides (EADDRINUSE) and a single AUTH_MAGIC_LINK_WEBHOOK_URL
 * cannot be pointed at more than one of them anyway. globalSetup starts one
 * broker; specs reserve a turn through `signInAsAdmin`.
 *
 * The application POSTs the magic-link email payload to the webhook URL, which
 * carries no request identity, so turns are handed out one at a time. Control
 * endpoints live under a dedicated prefix that no delivery can shadow, and
 * every other POST is treated as a delivery: that keeps the broker working
 * whether AUTH_MAGIC_LINK_WEBHOOK_URL is "http://127.0.0.1:3199" or carries a
 * path, instead of silently 404ing a mismatched path and hanging the spec.
 */

const defaultWebhookUrl = "http://127.0.0.1:3199";
const controlPrefix = "/__magic-link-broker";
const requestPathPattern = new RegExp(`^${controlPrefix}/requests/([^/]+)$`);
export const adminEmail = "admin@example.test";
// A turn's deadline starts when the spec registers, and the spec only reaches
// the sign-in click after the dev web server compiles /auth/v1/login on demand.
// The authenticated specs allow 120s of test time for exactly that compile, so
// a 30s broker deadline would expire on a healthy but cold run. Stay under the
// specs' own timeout so a genuinely undelivered link still fails here, with the
// broker's explanation, rather than as an opaque Playwright timeout.
const defaultDeliveryTimeoutMs = 90_000;

export interface MagicLinkWebhookOptions {
  /** Origin the broker listens on. Only the hostname and port are used. */
  readonly webhookUrl?: URL;
  /** How long a spec's turn may wait for a delivery before it is failed. */
  readonly deliveryTimeoutMs?: number;
}

interface MagicLinkMessage {
  readonly text?: string;
}

interface BrokerRequest {
  readonly id: string;
  waiter?: ServerResponse;
  timer?: NodeJS.Timeout;
}

export function getWebhookUrl(): URL {
  return new URL(process.env.AUTH_MAGIC_LINK_WEBHOOK_URL ?? defaultWebhookUrl);
}

export function magicLinkRequestUrl(requestId: string, webhookUrl = getWebhookUrl()): URL {
  return new URL(`${controlPrefix}/requests/${requestId}`, webhookUrl);
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function respondWithJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

export function startMagicLinkWebhook(options: MagicLinkWebhookOptions = {}): Promise<Server> {
  const webhookUrl = options.webhookUrl ?? getWebhookUrl();
  const deliveryTimeoutMs = options.deliveryTimeoutMs ?? defaultDeliveryTimeoutMs;

  // Turn queue. The head holds the active turn; the application's next delivery
  // belongs to it. Registration is answered immediately, so a queued spec never
  // leaves a request unanswered on the wire.
  const queue: BrokerRequest[] = [];
  // Links that arrived before their spec asked for them.
  const deliveredLinks = new Map<string, string>();

  function findRequest(requestId: string): BrokerRequest | undefined {
    return queue.find((entry) => entry.id === requestId);
  }

  function startDeadline(entry: BrokerRequest): void {
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      finishRequest(entry, 504, {
        error: `No magic link arrived for request ${entry.id} within ${deliveryTimeoutMs}ms.`,
      });
    }, deliveryTimeoutMs);
    entry.timer.unref();
  }

  function promoteHead(): void {
    const head = queue[0];
    if (head) startDeadline(head);
  }

  /** Remove a turn from the queue, answer its waiter, and hand the turn on. */
  function finishRequest(entry: BrokerRequest, status: number, body: unknown): void {
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    const waiter = entry.waiter;
    entry.waiter = undefined;
    if (waiter) respondWithJson(waiter, status, body);
    promoteHead();
  }

  function handleRegistration(requestId: string, response: ServerResponse): void {
    if (findRequest(requestId) || deliveredLinks.has(requestId)) {
      respondWithJson(response, 409, { error: "That magic-link request is already registered." });
      return;
    }

    queue.push({ id: requestId });
    // Answered right away: a queued spec must not hold an unanswered socket
    // that Node's requestTimeout could destroy mid-suite.
    response.writeHead(204).end();
    promoteHead();
  }

  function handleDeliveryWait(requestId: string, response: ServerResponse): void {
    const deliveredLink = deliveredLinks.get(requestId);
    if (deliveredLink) {
      deliveredLinks.delete(requestId);
      respondWithJson(response, 200, { url: deliveredLink });
      return;
    }

    const entry = findRequest(requestId);
    if (!entry) {
      respondWithJson(response, 404, { error: "That magic-link request is not registered." });
      return;
    }
    if (entry.waiter) {
      respondWithJson(response, 409, { error: "That magic-link request already has a delivery waiter." });
      return;
    }

    entry.waiter = response;
    response.on("close", () => {
      if (!response.writableEnded && entry.waiter === response) {
        // The spec gave up. Drop its turn without writing to a dead socket so
        // the next queued spec is not blocked behind it.
        entry.waiter = undefined;
        finishRequest(entry, 410, { error: "The waiting browser spec disconnected." });
      }
    });
    promoteHead();
  }

  function handleDelivery(link: string, response: ServerResponse): void {
    const active = queue[0];
    if (!active) {
      respondWithJson(response, 409, { error: "No browser spec is waiting for a magic link." });
      return;
    }

    // A link that arrives before its spec asks for it is held for the follow-up GET.
    if (!active.waiter) deliveredLinks.set(active.id, link);
    finishRequest(active, 200, { url: link });
    response.writeHead(204).end();
  }

  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", webhookUrl);
      const requestId = requestUrl.pathname.match(requestPathPattern)?.[1];
      const method = request.method ?? "GET";

      if (method === "GET" && requestUrl.pathname === `${controlPrefix}/health`) {
        response.writeHead(204).end();
        return;
      }

      if (requestId) {
        if (method === "POST") {
          handleRegistration(requestId, response);
          return;
        }
        if (method === "GET") {
          handleDeliveryWait(requestId, response);
          return;
        }
        if (method === "DELETE") {
          const entry = findRequest(requestId);
          deliveredLinks.delete(requestId);
          if (entry) finishRequest(entry, 409, { error: "That magic-link request was cancelled." });
          response.writeHead(204).end();
          return;
        }
        respondWithJson(response, 405, { error: `Unsupported method ${method} for a magic-link request.` });
        return;
      }

      // Anything else that POSTs is the application delivering a magic-link
      // email, whatever path AUTH_MAGIC_LINK_WEBHOOK_URL carries.
      if (method === "POST") {
        let message: MagicLinkMessage;
        try {
          message = JSON.parse(await readRequestBody(request)) as MagicLinkMessage;
        } catch {
          respondWithJson(response, 400, { error: "The webhook payload was not JSON." });
          return;
        }
        const link = message.text?.match(/https?:\/\/\S+/)?.[0];
        if (!link) {
          respondWithJson(response, 400, { error: "The webhook payload did not contain a magic link." });
          return;
        }
        handleDelivery(link, response);
        return;
      }

      respondWithJson(response, 404, { error: `No magic-link broker route for ${method} ${requestUrl.pathname}.` });
    })().catch((error: unknown) => {
      respondWithJson(response, 500, { error: `The magic-link broker failed: ${String(error)}` });
    });
  });

  // Delivery waits are bounded by deliveryTimeoutMs, but a queued spec's wait
  // is bounded only by the specs ahead of it, which can exceed Node's default
  // 300s requestTimeout and destroy the socket mid-suite.
  server.requestTimeout = 0;

  return new Promise((resolve, reject) => {
    const onListenError = (error: Error): void => reject(error);
    server.once("error", onListenError);
    server.listen(Number(webhookUrl.port), webhookUrl.hostname, () => {
      server.removeListener("error", onListenError);
      // Without a standing handler, any post-listen 'error' event is unhandled
      // and takes down the Playwright main process.
      server.on("error", (error: Error) => {
        console.error("[magic-link-webhook] broker error:", error);
      });
      resolve(server);
    });
  });
}

export async function stopMagicLinkWebhook(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function signInAsAdmin(page: Page, email = adminEmail): Promise<void> {
  const requestUrl = magicLinkRequestUrl(randomUUID());
  const registration = await fetch(requestUrl, { method: "POST" });
  if (!registration.ok) throw new Error(`Could not register a magic-link request (${registration.status}).`);

  const deliveryPromise = fetch(requestUrl);
  // Claim the rejection now. If a page step below throws first, nothing awaits
  // this promise, and an unhandled rejection would kill the Playwright worker.
  deliveryPromise.catch(() => undefined);

  try {
    // Land back on a stable public route after verification. Returning to /dashboard lets its
    // event-selection redirect race the caller's first navigation and intermittently abort it.
    const callbackURL = "/auth/v1/login?signedIn=1";
    await page.goto(`/auth/v1/login?callbackURL=${encodeURIComponent(callbackURL)}`);
    await page.getByRole("textbox", { name: "Email address" }).fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();

    const delivery = await deliveryPromise;
    if (!delivery.ok) {
      const detail = await delivery.text().catch(() => "");
      throw new Error(`Could not receive the requested magic link (${delivery.status}). ${detail}`.trim());
    }
    const { url } = (await delivery.json()) as { url: string };
    await page.goto(url);
    // Better Auth creates the account on first sign-in, and a fixture may have deleted the
    // one global setup seeded, so re-grant the organizer membership the dashboard reads.
    await grantSeededOrganizationAccess(email);
  } catch (error) {
    await fetch(requestUrl, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

export async function signUpOrganization(page: Page, email: string, organizationName: string): Promise<void> {
  const requestUrl = magicLinkRequestUrl(randomUUID());
  const registration = await fetch(requestUrl, { method: "POST" });
  if (!registration.ok) throw new Error(`Could not register an organization-signup request (${registration.status}).`);

  const deliveryPromise = fetch(requestUrl);
  deliveryPromise.catch(() => undefined);

  try {
    await page.goto("/auth/v1/register");
    await page.getByRole("textbox", { name: "Organization name" }).fill(organizationName);
    await page.getByRole("textbox", { name: "Email address" }).fill(email);
    await page.getByRole("button", { name: "Email me a signup link" }).click();
    await page.getByText("Check your inbox").waitFor();

    const delivery = await deliveryPromise;
    if (!delivery.ok) {
      const detail = await delivery.text().catch(() => "");
      throw new Error(`Could not receive the organization signup link (${delivery.status}). ${detail}`.trim());
    }
    const { url } = (await delivery.json()) as { url: string };
    await page.goto(url);
  } catch (error) {
    await fetch(requestUrl, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}
