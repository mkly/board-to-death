import type { Page } from "@playwright/test";

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const defaultWebhookUrl = "http://127.0.0.1:3199/magic-link";
const adminEmail = "admin@example.test";

interface MagicLinkMessage {
  readonly text?: string;
}

interface PendingAcquisition {
  readonly requestId: string;
  readonly response: ServerResponse;
}

function getWebhookUrl(): URL {
  return new URL(process.env.AUTH_MAGIC_LINK_WEBHOOK_URL ?? defaultWebhookUrl);
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
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

export function startMagicLinkWebhook(webhookUrl = getWebhookUrl()): Promise<Server> {
  const pendingAcquisitions: PendingAcquisition[] = [];
  const waitingForDelivery = new Map<string, ServerResponse>();
  const deliveredLinks = new Map<string, string>();
  let activeRequestId: string | undefined;

  function activateNextRequest(): void {
    const next = pendingAcquisitions.shift();
    if (!next) {
      activeRequestId = undefined;
      return;
    }

    activeRequestId = next.requestId;
    next.response.writeHead(204).end();
  }

  function cancelRequest(requestId: string): void {
    if (activeRequestId === requestId) {
      activateNextRequest();
    } else {
      const queuedIndex = pendingAcquisitions.findIndex((pending) => pending.requestId === requestId);
      if (queuedIndex >= 0) {
        pendingAcquisitions.splice(queuedIndex, 1)[0]?.response.writeHead(409).end();
      }
    }

    deliveredLinks.delete(requestId);
    waitingForDelivery.get(requestId)?.writeHead(409).end();
    waitingForDelivery.delete(requestId);
  }

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", webhookUrl);
    const requestMatch = requestUrl.pathname.match(/^\/magic-link\/requests\/([^/]+)$/);
    const requestId = requestMatch?.[1];

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      response.writeHead(204).end();
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === webhookUrl.pathname) {
      if (!activeRequestId) {
        respondWithJson(response, 409, { error: "No browser spec is waiting for a magic link." });
        return;
      }

      const message = JSON.parse(await readRequestBody(request)) as MagicLinkMessage;
      const link = message.text?.match(/https?:\/\/\S+/)?.[0];
      if (!link) {
        respondWithJson(response, 400, { error: "The webhook payload did not contain a magic link." });
        return;
      }

      const deliveredRequestId = activeRequestId;
      const deliveryResponse = waitingForDelivery.get(deliveredRequestId);
      if (deliveryResponse) {
        respondWithJson(deliveryResponse, 200, { url: link });
        waitingForDelivery.delete(deliveredRequestId);
      } else {
        deliveredLinks.set(deliveredRequestId, link);
      }

      response.writeHead(204).end();
      activateNextRequest();
      return;
    }

    if (requestId && request.method === "POST") {
      if (activeRequestId === requestId || pendingAcquisitions.some((pending) => pending.requestId === requestId)) {
        respondWithJson(response, 409, { error: "That magic-link request is already registered." });
        return;
      }

      if (!activeRequestId) {
        activeRequestId = requestId;
        response.writeHead(204).end();
      } else {
        const pending = { requestId, response };
        pendingAcquisitions.push(pending);
        response.on("close", () => {
          if (!response.writableEnded) {
            const index = pendingAcquisitions.indexOf(pending);
            if (index >= 0) pendingAcquisitions.splice(index, 1);
          }
        });
      }
      return;
    }

    if (requestId && request.method === "GET") {
      const deliveredLink = deliveredLinks.get(requestId);
      if (deliveredLink) {
        deliveredLinks.delete(requestId);
        respondWithJson(response, 200, { url: deliveredLink });
      } else if (
        activeRequestId === requestId ||
        pendingAcquisitions.some((pending) => pending.requestId === requestId)
      ) {
        if (waitingForDelivery.has(requestId)) {
          respondWithJson(response, 409, { error: "That magic-link request already has a delivery waiter." });
        } else {
          waitingForDelivery.set(requestId, response);
          response.on("close", () => {
            if (!response.writableEnded && waitingForDelivery.get(requestId) === response) {
              waitingForDelivery.delete(requestId);
              cancelRequest(requestId);
            }
          });
        }
      } else {
        respondWithJson(response, 404, { error: "That magic-link request is not registered." });
      }
      return;
    }

    if (requestId && request.method === "DELETE") {
      cancelRequest(requestId);
      response.writeHead(204).end();
      return;
    }

    response.writeHead(404).end();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(webhookUrl.port), webhookUrl.hostname, () => resolve(server));
  });
}

export async function signInAsAdmin(page: Page): Promise<void> {
  const webhookUrl = getWebhookUrl();
  const requestId = randomUUID();
  const requestUrl = new URL(`/magic-link/requests/${requestId}`, webhookUrl);
  const registration = await fetch(requestUrl, { method: "POST" });
  if (!registration.ok) throw new Error(`Could not register a magic-link request (${registration.status}).`);
  const deliveryPromise = fetch(requestUrl);

  try {
    await page.goto("/auth/v1/login");
    await page.getByRole("textbox", { name: "Email address" }).fill(adminEmail);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();

    const delivery = await deliveryPromise;
    if (!delivery.ok) throw new Error(`Could not receive the requested magic link (${delivery.status}).`);
    const { url } = (await delivery.json()) as { url: string };
    await page.goto(url);
  } catch (error) {
    await fetch(requestUrl, { method: "DELETE" });
    throw error;
  }
}
