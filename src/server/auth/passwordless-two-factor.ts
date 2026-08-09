import type { HookEndpointContext } from "@better-auth/core";
import { createAuthMiddleware } from "@better-auth/core/api";
import { APIError } from "@better-auth/core/error";
import { getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie, expireCookie } from "better-auth/cookies";

import { createHash, randomBytes } from "node:crypto";

const CHALLENGE_MAX_AGE_SECONDS = 10 * 60;
const REAUTH_MAX_AGE_SECONDS = 5 * 60;
const USED_CODE_MAX_AGE_SECONDS = 90;
const REAUTH_COOKIE_NAME = "two_factor_reauth";

function decodeCallbackURL(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function safeCallbackURL(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function resultUserId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("user" in value)) return undefined;
  const user = value.user;
  if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string") return undefined;
  return user.id;
}

function usedCodeIdentifier(userId: string, code: string): string {
  return `2fa-used-code-${userId}-${createHash("sha256").update(code).digest("hex")}`;
}

/**
 * Better Auth deliberately does not challenge passwordless sign-ins with its
 * two-factor plugin: its own challenge hook only matches the credential
 * sign-in paths. This hook mirrors that handler for `/magic-link/verify`, so
 * the session the magic link just created is destroyed inside the same request
 * that created it and the response carries the pending 2FA challenge instead.
 * Doing it here rather than behind a redirect the client has to follow is what
 * makes the second factor mandatory — a client that ignores the redirect never
 * receives a usable session token.
 */
export function passwordlessTwoFactor() {
  return {
    id: "passwordless-two-factor",
    hooks: {
      after: [
        {
          matcher: (context: HookEndpointContext) => context.path === "/magic-link/verify",
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            if (!created?.user.twoFactorEnabled) return;

            deleteSessionCookie(ctx, true);
            await ctx.context.internalAdapter.deleteSession(created.session.token);
            ctx.context.setNewSession(null);

            const identifier = `2fa-${randomBytes(20).toString("hex")}`;
            const expiresAt = new Date(Date.now() + CHALLENGE_MAX_AGE_SECONDS * 1_000);
            await Promise.all([
              ctx.context.internalAdapter.createVerificationValue({
                identifier,
                value: created.user.id,
                expiresAt,
              }),
              ctx.context.internalAdapter.createVerificationValue({
                identifier: `2fa-attempts-${identifier}`,
                value: "0",
                expiresAt,
              }),
            ]);

            const challengeCookie = ctx.context.createAuthCookie("two_factor", {
              maxAge: CHALLENGE_MAX_AGE_SECONDS,
            });
            await ctx.setSignedCookie(challengeCookie.name, identifier, ctx.context.secret, challengeCookie.attributes);

            const verificationURL = new URL("/auth/v1/two-factor", ctx.context.baseURL);
            verificationURL.searchParams.set("callbackURL", safeCallbackURL(decodeCallbackURL(ctx.query?.callbackURL)));
            throw ctx.redirect(verificationURL.toString());
          }),
        },
        {
          matcher: (context: HookEndpointContext) => context.path === "/two-factor/verify-totp",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (!session || !ctx.context.returned || ctx.context.returned instanceof APIError) return;

            const identifier = `2fa-reauth-${randomBytes(20).toString("hex")}`;
            await ctx.context.internalAdapter.createVerificationValue({
              identifier,
              value: session.user.id,
              expiresAt: new Date(Date.now() + REAUTH_MAX_AGE_SECONDS * 1_000),
            });

            const cookie = ctx.context.createAuthCookie(REAUTH_COOKIE_NAME, { maxAge: REAUTH_MAX_AGE_SECONDS });
            await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
          }),
        },
        {
          matcher: (context: HookEndpointContext) => context.path === "/two-factor/verify-totp",
          handler: createAuthMiddleware(async (ctx) => {
            if (!ctx.context.returned || ctx.context.returned instanceof APIError) return;
            const userId = resultUserId(ctx.context.returned);
            const code = typeof ctx.body?.code === "string" ? ctx.body.code : undefined;
            if (!userId || !code) return;

            await ctx.context.internalAdapter.createVerificationValue({
              identifier: usedCodeIdentifier(userId, code),
              value: userId,
              expiresAt: new Date(Date.now() + USED_CODE_MAX_AGE_SECONDS * 1_000),
            });
          }),
        },
      ],
      before: [
        {
          matcher: (context: HookEndpointContext) => context.path === "/two-factor/verify-totp",
          handler: createAuthMiddleware(async (ctx) => {
            const code = typeof ctx.body?.code === "string" ? ctx.body.code : undefined;
            if (!code) return;

            const session = await getSessionFromCtx(ctx);
            let userId = session?.user.id;
            if (!userId) {
              const challengeCookie = ctx.context.createAuthCookie("two_factor", {
                maxAge: CHALLENGE_MAX_AGE_SECONDS,
              });
              const challengeIdentifier = await ctx.getSignedCookie(challengeCookie.name, ctx.context.secret);
              const challenge = challengeIdentifier
                ? await ctx.context.internalAdapter.findVerificationValue(challengeIdentifier)
                : null;
              userId = challenge?.value;
            }

            if (!userId) return;
            const usedCode = await ctx.context.internalAdapter.findVerificationValue(usedCodeIdentifier(userId, code));
            if (usedCode && usedCode.expiresAt > new Date()) {
              throw APIError.from("UNAUTHORIZED", {
                code: "TOTP_CODE_ALREADY_USED",
                message: "This authenticator code has already been used.",
              });
            }
          }),
        },
        {
          matcher: (context: HookEndpointContext) =>
            context.path === "/two-factor/disable" || context.path === "/two-factor/generate-backup-codes",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            const cookie = ctx.context.createAuthCookie(REAUTH_COOKIE_NAME, { maxAge: REAUTH_MAX_AGE_SECONDS });
            const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
            const verification = identifier
              ? await ctx.context.internalAdapter.consumeVerificationValue(identifier)
              : null;

            expireCookie(ctx, cookie);
            if (!session || !verification || verification.value !== session.user.id) {
              throw APIError.from("UNAUTHORIZED", {
                code: "TWO_FACTOR_REAUTHENTICATION_REQUIRED",
                message: "Verify a current authenticator code before managing two-factor authentication.",
              });
            }
          }),
        },
      ],
    },
  };
}
