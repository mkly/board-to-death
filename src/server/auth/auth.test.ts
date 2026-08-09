import { base32 } from "@better-auth/utils/base32";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { PrismaClient } from "@/generated/prisma/client";

import { getAllowedAdminEmails, isAllowedAdminEmail, isAuthorizedAdminSession } from "./admin-access";
import { createAuth } from "./auth-factory";

const baseURL = "http://localhost:3000";
const testEmail = "admin@example.test";
const databaseUrl = process.env.DATABASE_URL;
const databaseDescribe = databaseUrl?.includes("_test") ? describe : describe.skip;
const deliveredLinks: string[] = [];
let activeCookie = "";
let auth: ReturnType<typeof createAuth>;
let database: PrismaClient;

test("uses the runtime-config allowlist for dashboard session authorization", () => {
  const originalAllowedEmails = process.env.AUTH_ALLOWED_EMAILS;

  try {
    delete process.env.AUTH_ALLOWED_EMAILS;

    const runtimeAllowedEmails = getAllowedAdminEmails(getRuntimeConfig().server.AUTH_ALLOWED_EMAILS);
    const session = { user: { email: testEmail } };

    expect(isAllowedAdminEmail(session.user.email, runtimeAllowedEmails)).toBe(true);
    expect(isAuthorizedAdminSession(session)).toBe(true);
  } finally {
    if (originalAllowedEmails === undefined) {
      delete process.env.AUTH_ALLOWED_EMAILS;
    } else {
      process.env.AUTH_ALLOWED_EMAILS = originalAllowedEmails;
    }
  }
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

async function requestMagicLink(email = testEmail, callbackURL = "/dashboard"): Promise<Response> {
  return auth.handler(
    request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL }),
    }),
  );
}

function namedCookie(response: Response, name: string): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`${name.replaceAll(".", "\\.")}=([^;,]+)`));
  if (!match?.[1]) throw new Error(`Expected Better Auth to set ${name}`);
  return `${name}=${match[1]}`;
}

async function postAuth(path: string, cookie: string, body: object): Promise<Response> {
  return auth.handler(
    request(`/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
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

databaseDescribe("admin magic-link authentication", () => {
  beforeAll(async () => {
    if (!databaseUrl?.includes("_test")) {
      throw new Error("Auth integration tests require a guarded *_test DATABASE_URL");
    }

    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    auth = createAuth({
      baseURL,
      database,
      isAllowedEmail: (email) => email.toLowerCase() === testEmail,
      secret: "test-only-better-auth-secret-at-least-32-characters",
      sendMagicLink: async ({ url }) => {
        deliveredLinks.push(url);
      },
      twoFactorLockoutDuration: 1,
      twoFactorMaxFailedAttempts: 3,
      twoFactorPeriod: 1,
    });

    await database.twoFactor.deleteMany();
    await database.verification.deleteMany();
    await database.account.deleteMany();
    await database.session.deleteMany();
    await database.user.deleteMany();
  });

  afterAll(async () => {
    await database.$disconnect();
  });

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

  test("enforces passwordless TOTP challenges, code reuse, rate limits, recovery, and re-verification", async () => {
    await requestMagicLink();
    const enrollmentLink = deliveredLinks.at(-1);
    if (!enrollmentLink) throw new Error("Expected an enrollment sign-in link");
    const enrollmentSignIn = await auth.handler(new Request(enrollmentLink, { redirect: "manual" }));
    const enrollmentCookie = sessionCookie(enrollmentSignIn);

    const enabled = await postAuth("/two-factor/enable", enrollmentCookie, {});
    expect(enabled.status).toBe(200);
    const enrollment = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
    const encodedSecret = new URL(enrollment.totpURI).searchParams.get("secret");
    if (!encodedSecret) throw new Error("Expected a TOTP secret");
    const secret = new TextDecoder().decode(base32.decode(encodedSecret));

    const enrollmentCode = (await auth.api.generateTOTP({ body: { secret } })).code;
    const confirmed = await postAuth("/two-factor/verify-totp", enrollmentCookie, { code: enrollmentCode });
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    const confirmedSession = namedCookie(confirmed, "better-auth.session_token");
    expect((await database.user.findUniqueOrThrow({ where: { email: testEmail } })).twoFactorEnabled).toBe(true);

    const unverifiedDisable = await postAuth("/two-factor/disable", confirmedSession, {});
    expect(unverifiedDisable.status).toBe(401);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await requestMagicLink(testEmail, "/api/auth/two-factor/start-passwordless?callbackURL=%2Fdashboard%2Fevents");
    const challengedLink = deliveredLinks.at(-1);
    if (!challengedLink) throw new Error("Expected a challenged sign-in link");
    const passwordlessSession = await auth.handler(new Request(challengedLink, { redirect: "manual" }));
    const startURL = passwordlessSession.headers.get("location");
    if (!startURL) throw new Error("Expected the challenge start redirect");
    const challengeStart = await auth.handler(
      new Request(startURL, { headers: { cookie: sessionCookie(passwordlessSession) }, redirect: "manual" }),
    );
    expect(challengeStart.headers.get("location")).toContain("/auth/v1/two-factor?callbackURL=%2Fdashboard%2Fevents");
    const challengeCookie = namedCookie(challengeStart, "better-auth.two_factor");
    const signInCode = (await auth.api.generateTOTP({ body: { secret } })).code;
    const verified = await postAuth("/two-factor/verify-totp", challengeCookie, { code: signInCode });
    expect(verified.status).toBe(200);

    await requestMagicLink(testEmail, "/api/auth/two-factor/start-passwordless?callbackURL=%2Fdashboard");
    const reuseLink = deliveredLinks.at(-1);
    if (!reuseLink) throw new Error("Expected a code-reuse sign-in link");
    const reuseSession = await auth.handler(new Request(reuseLink, { redirect: "manual" }));
    const reuseStartURL = reuseSession.headers.get("location");
    if (!reuseStartURL) throw new Error("Expected the code-reuse challenge start redirect");
    const reuseStart = await auth.handler(
      new Request(reuseStartURL, { headers: { cookie: sessionCookie(reuseSession) }, redirect: "manual" }),
    );
    const reuseChallengeCookie = namedCookie(reuseStart, "better-auth.two_factor");
    const reused = await postAuth("/two-factor/verify-totp", reuseChallengeCookie, { code: signInCode });
    expect(reused.status).toBe(401);
    for (const invalidCode of ["000000", "000001", "000002"]) {
      expect((await postAuth("/two-factor/verify-totp", reuseChallengeCookie, { code: invalidCode })).status).toBe(401);
    }

    await requestMagicLink(testEmail, "/api/auth/two-factor/start-passwordless?callbackURL=%2Fdashboard");
    const lockedLink = deliveredLinks.at(-1);
    if (!lockedLink) throw new Error("Expected a locked-account sign-in link");
    const lockedSession = await auth.handler(new Request(lockedLink, { redirect: "manual" }));
    const lockedStartURL = lockedSession.headers.get("location");
    if (!lockedStartURL) throw new Error("Expected the locked-account challenge start redirect");
    const lockedStart = await auth.handler(
      new Request(lockedStartURL, { headers: { cookie: sessionCookie(lockedSession) }, redirect: "manual" }),
    );
    const lockedChallengeCookie = namedCookie(lockedStart, "better-auth.two_factor");
    const rateLimited = await postAuth("/two-factor/verify-totp", lockedChallengeCookie, { code: "000003" });
    expect(rateLimited.status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const recovered = await postAuth("/two-factor/verify-backup-code", lockedChallengeCookie, {
      code: enrollment.backupCodes[0],
    });
    expect(recovered.status).toBe(200);
    const recoveredSession = namedCookie(recovered, "better-auth.session_token");

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const managementCode = (await auth.api.generateTOTP({ body: { secret } })).code;
    const reverified = await postAuth("/two-factor/verify-totp", recoveredSession, { code: managementCode });
    expect(reverified.status).toBe(200);
    const managementCookies = `${recoveredSession}; ${namedCookie(reverified, "better-auth.two_factor_reauth")}`;
    const regenerated = await postAuth("/two-factor/generate-backup-codes", managementCookies, {});
    expect(regenerated.status).toBe(200);
    expect(((await regenerated.json()) as { backupCodes: string[] }).backupCodes).toHaveLength(10);

    const replayedManagement = await postAuth("/two-factor/disable", managementCookies, {});
    expect(replayedManagement.status).toBe(401);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const disableCode = (await auth.api.generateTOTP({ body: { secret } })).code;
    const disableVerification = await postAuth("/two-factor/verify-totp", recoveredSession, { code: disableCode });
    expect(disableVerification.status).toBe(200);
    const disableCookies = `${recoveredSession}; ${namedCookie(disableVerification, "better-auth.two_factor_reauth")}`;
    const disabled = await postAuth("/two-factor/disable", disableCookies, {});
    expect(disabled.status).toBe(200);
    expect((await database.user.findUniqueOrThrow({ where: { email: testEmail } })).twoFactorEnabled).toBe(false);
  }, 15_000);
});
