import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ResendEmailService } from "./resend-email";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const message = {
  to: [{ address: "person@example.com", name: "Example Person" }],
  subject: "Conference update",
  text: "The schedule changed.",
  html: "<p>The schedule changed.</p>",
  idempotencyKey: "conference-update/message-1",
  attachments: [
    {
      filename: "schedule.txt",
      contentType: "text/plain",
      content: "VGhlIHNjaGVkdWxlIGNoYW5nZWQu",
      disposition: "attachment" as const,
    },
  ],
};

describe("ResendEmailService", () => {
  test("sends a message with its idempotency key and attachments", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ id: "email_123" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new ResendEmailService({ apiKey: "re_test", fromEmail: "mail@example.com" });

    const result = await service.send(message);

    expect(result).toMatchObject({ ok: true, value: { messageId: "email_123" } });
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request?.headers).toEqual({
      authorization: "Bearer re_test",
      "content-type": "application/json",
      "idempotency-key": "conference-update/message-1",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      from: "GatherPulse <mail@example.com>",
      to: ["Example Person <person@example.com>"],
      subject: "Conference update",
      text: "The schedule changed.",
      html: "<p>The schedule changed.</p>",
      attachments: [{ filename: "schedule.txt", content: "VGhlIHNjaGVkdWxlIGNoYW5nZWQu" }],
    });
  });

  test("returns a retriable failure with Resend's retry delay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ name: "rate_limit_exceeded" }, { status: 429, headers: { "retry-after": "3" } }),
      ),
    );
    const service = new ResendEmailService({ apiKey: "re_test", fromEmail: "mail@example.com" });

    await expect(service.send(message)).resolves.toEqual({
      ok: false,
      error: {
        service: "email",
        code: "rate-limited",
        message: "The service rate limit was reached.",
        retryable: true,
        retryAfterMs: 3_000,
      },
    });
  });

  test("returns a terminal failure for a rejected message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ name: "invalid_attachment" }, { status: 422 })),
    );
    const service = new ResendEmailService({ apiKey: "re_test", fromEmail: "mail@example.com" });

    await expect(service.send(message)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-input", retryable: false },
    });
  });

  test("distinguishes concurrent idempotent requests from terminal idempotency conflicts", async () => {
    const service = new ResendEmailService({ apiKey: "re_test", fromEmail: "mail@example.com" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ name: "concurrent_idempotent_requests" }, { status: 409 })),
    );

    await expect(service.send(message)).resolves.toMatchObject({
      ok: false,
      error: { code: "unavailable", retryable: true },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ name: "invalid_idempotent_request" }, { status: 409 })),
    );
    await expect(service.send(message)).resolves.toMatchObject({
      ok: false,
      error: { code: "conflict", retryable: false },
    });
  });

  test("logs and succeeds when Resend is not configured", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new ResendEmailService({});

    const result = await service.send(message);

    expect(result).toMatchObject({ ok: true, value: { messageId: expect.stringMatching(/^development-email-/) } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith("[email] Resend is not configured; logging delivery instead.", {
      recipients: ["person@example.com"],
      subject: "Conference update",
    });
  });
});
