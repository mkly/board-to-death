import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createConfiguredMagicLinkSender } from "./magic-link-email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("configured magic-link delivery", () => {
  test("prints the link instead of contacting a provider in development console-only mode", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal("fetch", fetchMock);
    const send = createConfiguredMagicLinkSender({
      resendApiKey: "re_test_key",
      resendFromEmail: "noreply@updates.example.com",
    });

    await send({ email: "speaker@example.com", url: "http://localhost:3000/portal/summit/auth?token=secret" });

    expect(infoSpy).toHaveBeenCalledWith(
      "[auth] Magic link for speaker@example.com: http://localhost:3000/portal/summit/auth?token=secret",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not print a link outside development when delivery is not configured", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "production");
    const send = createConfiguredMagicLinkSender({});

    await expect(
      send({ email: "speaker@example.com", url: "https://events.example.com/portal/summit/auth?token=secret" }),
    ).rejects.toThrow("Magic-link delivery is not configured.");
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test("sends magic links through Resend when configured", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const send = createConfiguredMagicLinkSender({
      resendApiKey: "re_test_key",
      resendFromEmail: "noreply@updates.example.com",
    });

    await send({ email: "admin@example.com", url: "https://events.example.com/sign-in?token=a&next=%2Fdashboard" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, request] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toBe("https://api.resend.com/emails");
    expect(request?.headers).toEqual({
      authorization: "Bearer re_test_key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      from: "GatherPulse <noreply@updates.example.com>",
      to: ["admin@example.com"],
      subject: "Sign in to GatherPulse",
      text: "Use this single-use link to sign in. It expires in 10 minutes: https://events.example.com/sign-in?token=a&next=%2Fdashboard",
      html: '<p>Use this single-use link to sign in:</p><p><a href="https://events.example.com/sign-in?token=a&amp;next=%2Fdashboard">Sign in to GatherPulse</a></p><p>This link expires in 10 minutes.</p>',
    });
  });

  test("delivers configured wording instead of the sign-in copy", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const send = createConfiguredMagicLinkSender({
      resendApiKey: "re_test_key",
      resendFromEmail: "noreply@updates.example.com",
      wording: {
        subject: "Confirm your speaking participation",
        textIntro: "Use this single-use link to confirm your speaking participation. This link expires in 7 days:",
        htmlIntro: "Use this single-use link to confirm your speaking participation:",
        linkLabel: "Confirm your participation",
        htmlExpiry: "This link expires in 7 days.",
      },
    });

    await send({ email: "speaker@example.com", url: "https://events.example.com/portal/summit/confirm?token=a" });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toEqual({
      from: "GatherPulse <noreply@updates.example.com>",
      to: ["speaker@example.com"],
      subject: "Confirm your speaking participation",
      text: "Use this single-use link to confirm your speaking participation. This link expires in 7 days: https://events.example.com/portal/summit/confirm?token=a",
      html: '<p>Use this single-use link to confirm your speaking participation:</p><p><a href="https://events.example.com/portal/summit/confirm?token=a">Confirm your participation</a></p><p>This link expires in 7 days.</p>',
    });
  });

  test("surfaces rejected Resend deliveries without exposing the response body", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("sensitive provider detail", { status: 403 })),
    );
    const send = createConfiguredMagicLinkSender({
      resendApiKey: "re_test_key",
      resendFromEmail: "noreply@updates.example.com",
    });

    await expect(send({ email: "admin@example.com", url: "https://events.example.com/sign-in" })).rejects.toThrow(
      "Resend rejected magic-link delivery with status 403",
    );
    expect(errorSpy).toHaveBeenCalledWith("[auth] Magic-link delivery failed", {
      provider: "resend",
      email: "admin@example.com",
      error: "Resend rejected magic-link delivery with status 403",
    });
  });

  test("logs rejected webhook deliveries without exposing the magic-link URL", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("sensitive webhook detail", { status: 502 })),
    );
    const send = createConfiguredMagicLinkSender({
      webhookToken: "test-token",
      webhookUrl: "https://mailer.example.com/magic-link",
    });

    await expect(
      send({ email: "reviewer@example.com", url: "https://events.example.com/sign-in?token=secret" }),
    ).rejects.toThrow("Magic-link webhook rejected delivery with status 502");
    expect(errorSpy).toHaveBeenCalledWith("[auth] Magic-link delivery failed", {
      provider: "webhook",
      email: "reviewer@example.com",
      error: "Magic-link webhook rejected delivery with status 502",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("token=secret");
  });
});
