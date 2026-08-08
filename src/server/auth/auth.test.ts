import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { isAuthorizedAdminSession } from "./admin-access";
import { createAuth } from "./auth-factory";

const baseURL = "http://localhost:3000";
const testEmail = "admin@example.test";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.includes("_test")) {
  throw new Error("Auth integration tests require a guarded *_test DATABASE_URL");
}

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const deliveredLinks: string[] = [];
let activeCookie = "";

process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL = baseURL;

const auth = createAuth({
  database,
  isAllowedEmail: (email) => email.toLowerCase() === testEmail,
  sendMagicLink: async ({ url }) => {
    deliveredLinks.push(url);
  },
});

function request(path: string, init?: RequestInit): Request {
  return new Request(new URL(path, baseURL), {
    ...init,
    headers: {
      origin: baseURL,
      ...init?.headers,
    },
  });
}

async function requestMagicLink(email = testEmail): Promise<Response> {
  return auth.handler(
    request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/dashboard" }),
    }),
  );
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
  if (!match?.[1]) {
    throw new Error("Expected Better Auth to set a session cookie");
  }
  return `better-auth.session_token=${match[1]}`;
}

beforeAll(async () => {
  await database.verification.deleteMany();
  await database.account.deleteMany();
  await database.session.deleteMany();
  await database.user.deleteMany();
});

afterAll(async () => {
  await database.$disconnect();
});

describe("admin magic-link authentication", () => {
  test("delivers links only for configured administrator addresses", async () => {
    const allowed = await requestMagicLink();
    const denied = await requestMagicLink("stranger@example.test");

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(200);
    expect(deliveredLinks).toHaveLength(1);
    expect(deliveredLinks[0]).toContain("/api/auth/magic-link/verify");
  });

  test("creates a database session from a single-use link and rejects forged cookies", async () => {
    const link = deliveredLinks[0];
    if (!link) {
      throw new Error("Expected the preceding request to deliver a magic link");
    }

    const verified = await auth.handler(new Request(link, { redirect: "manual" }));
    const cookie = sessionCookie(verified);
    activeCookie = cookie;
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    const replay = await auth.handler(new Request(link, { redirect: "manual" }));
    const forged = await auth.api.getSession({
      headers: new Headers({ cookie: "better-auth.session_token=forged.invalid" }),
    });

    expect(verified.status).toBe(302);
    expect(session?.user.email).toBe(testEmail);
    expect(replay.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(forged).toBeNull();

    const originalAllowedEmails = process.env.AUTH_ALLOWED_EMAILS;
    try {
      process.env.AUTH_ALLOWED_EMAILS = `  ${testEmail.toUpperCase()}  `;
      expect(isAuthorizedAdminSession(session)).toBe(true);

      process.env.AUTH_ALLOWED_EMAILS = "another-admin@example.test";
      expect(isAuthorizedAdminSession(session)).toBe(false);
    } finally {
      process.env.AUTH_ALLOWED_EMAILS = originalAllowedEmails;
    }
  });

  test("refreshes aged sessions, expires old sessions, and revokes on logout", async () => {
    const stored = await database.session.findFirstOrThrow();
    const originalExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await database.session.update({
      where: { id: stored.id },
      data: { updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), expiresAt: originalExpiry },
    });

    const refreshed = await auth.api.getSession({
      headers: new Headers({ cookie: activeCookie }),
    });
    const rotated = await database.session.findUniqueOrThrow({ where: { id: stored.id } });

    expect(refreshed?.user.email).toBe(testEmail);
    expect(rotated.expiresAt.getTime()).toBeGreaterThan(originalExpiry.getTime());

    await database.session.update({ where: { id: stored.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const expired = await auth.api.getSession({
      headers: new Headers({ cookie: activeCookie }),
    });
    expect(expired).toBeNull();

    await requestMagicLink();
    const nextLink = deliveredLinks.at(-1);
    if (!nextLink) {
      throw new Error("Expected a replacement magic link");
    }
    const verified = await auth.handler(new Request(nextLink, { redirect: "manual" }));
    const cookie = sessionCookie(verified);
    const signedOut = await auth.handler(request("/api/auth/sign-out", { method: "POST", headers: { cookie } }));
    const revoked = await auth.api.getSession({ headers: new Headers({ cookie }) });

    expect(signedOut.status).toBe(200);
    expect(revoked).toBeNull();
  });
});
