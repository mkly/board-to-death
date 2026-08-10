import "server-only";

import { getRuntimeConfig } from "@/config/runtime-env.server";

import type { EmailAddress, EmailDelivery, EmailMessage, EmailService, InfrastructureResult } from "./contracts.ts";
import { infrastructureFailure, infrastructureSuccess } from "./results.ts";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

interface ResendEmailServiceOptions {
  readonly apiKey?: string;
  readonly fromEmail?: string;
}

interface ResendErrorBody {
  readonly name?: string;
}

interface ResendSuccessBody {
  readonly id?: string;
}

export function resendSenderAddress(fromEmail: string): string {
  return `GatherPulse <${fromEmail}>`;
}

function recipient(address: EmailAddress): string {
  return address.name ? `${address.name} <${address.address}>` : address.address;
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

async function responseBody<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

async function resendFailure(response: Response): Promise<InfrastructureResult<EmailDelivery>> {
  const retryDelay = retryAfterMs(response);

  if (response.status === 408 || response.status === 504) {
    return infrastructureFailure("email", "timeout", retryDelay);
  }
  if (response.status === 429) {
    const body = await responseBody<ResendErrorBody>(response);
    if (body?.name === "monthly_quota_exceeded") {
      return infrastructureFailure("email", "conflict");
    }
    return infrastructureFailure("email", "rate-limited", retryDelay);
  }
  if (response.status >= 500) {
    return infrastructureFailure("email", "unavailable", retryDelay);
  }
  if (response.status === 401 || response.status === 403) {
    return infrastructureFailure("email", "unauthorized");
  }
  if (response.status === 404) {
    return infrastructureFailure("email", "not-found");
  }
  if (response.status === 409) {
    const body = await responseBody<ResendErrorBody>(response);
    return infrastructureFailure(
      "email",
      body?.name === "concurrent_idempotent_requests" ? "unavailable" : "conflict",
      retryDelay,
    );
  }
  if (response.status === 400 || response.status === 405 || response.status === 422) {
    return infrastructureFailure("email", "invalid-input");
  }
  return infrastructureFailure("email", "unexpected");
}

export class ResendEmailService implements EmailService {
  readonly #apiKey?: string;
  readonly #fromEmail?: string;

  constructor(options: ResendEmailServiceOptions) {
    this.#apiKey = options.apiKey;
    this.#fromEmail = options.fromEmail;
  }

  async send(message: EmailMessage): Promise<InfrastructureResult<EmailDelivery>> {
    if (!this.#apiKey || !this.#fromEmail) {
      console.info("[email] Resend is not configured; logging delivery instead.", {
        recipients: message.to.map(({ address }) => address),
        subject: message.subject,
      });
      return infrastructureSuccess({
        messageId: `development-email-${crypto.randomUUID()}`,
        acceptedAt: new Date().toISOString(),
      });
    }

    if (message.to.length === 0 || message.subject.trim() === "" || message.text.trim() === "") {
      return infrastructureFailure("email", "invalid-input");
    }

    let response: Response;
    try {
      response = await fetch(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
          ...(message.idempotencyKey ? { "idempotency-key": message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: resendSenderAddress(this.#fromEmail),
          to: message.to.map(recipient),
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.attachments
            ? {
                // Resend's send API accepts filename and content, but has no fields for the
                // contract's contentType or disposition metadata.
                attachments: message.attachments.map(({ content, filename }) => ({ content, filename })),
              }
            : {}),
        }),
      });
    } catch (error) {
      return infrastructureFailure(
        "email",
        error instanceof DOMException && error.name === "AbortError" ? "timeout" : "unavailable",
      );
    }

    if (!response.ok) {
      return resendFailure(response);
    }

    const body = await responseBody<ResendSuccessBody>(response);
    if (!body?.id) {
      return infrastructureFailure("email", "unexpected");
    }
    return infrastructureSuccess({ messageId: body.id, acceptedAt: new Date().toISOString() });
  }
}

export function createConfiguredResendEmailService(): ResendEmailService {
  const config = getRuntimeConfig().server;
  return new ResendEmailService({ apiKey: config.RESEND_API_KEY, fromEmail: config.RESEND_FROM_EMAIL });
}
