import type { HookEndpointContext } from "@better-auth/core";
import { createAuthMiddleware } from "@better-auth/core/api";
import { APIError } from "@better-auth/core/error";
import { createAuthEndpoint, getSessionFromCtx, sessionMiddleware } from "better-auth/api";
import { deleteSessionCookie, expireCookie } from "better-auth/cookies";
import { z } from "zod";

import { createHash, randomBytes } from "node:crypto";

const CHALLENGE_MAX_AGE_SECONDS = 10 * 60;
const REAUTH_MAX_AGE_SECONDS = 5 * 60;
const USED_CODE_MAX_AGE_SECONDS = 90;
const REAUTH_COOKIE_NAME = "two_factor_reauth";
const callbackQuery = z.object({ callbackURL: z.string().optional() });

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
 * two-factor plugin. This endpoint converts the short-lived session created by
 * a magic link into the plugin's standard pending 2FA challenge.
 */
export function passwordlessTwoFactor() {
  return {
    id: "passwordless-two-factor",
    endpoints: {
      startPasswordlessTwoFactor: createAuthEndpoint(
        "/two-factor/start-passwordless",
        {
          method: "GET",
          query: callbackQuery,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const { session, user } = ctx.context.session;
          const callbackURL = safeCallbackURL(ctx.query.callbackURL);

          if (!user.twoFactorEnabled) {
            throw ctx.redirect(new URL(callbackURL, ctx.context.baseURL).toString());
          }

          deleteSessionCookie(ctx, true);
          await ctx.context.internalAdapter.deleteSession(session.token);

          const identifier = `2fa-${randomBytes(20).toString("hex")}`;
          const expiresAt = new Date(Date.now() + CHALLENGE_MAX_AGE_SECONDS * 1_000);
          await Promise.all([
            ctx.context.internalAdapter.createVerificationValue({
              identifier,
              value: user.id,
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
          verificationURL.searchParams.set("callbackURL", callbackURL);
          throw ctx.redirect(verificationURL.toString());
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path === "/two-factor/start-passwordless",
        window: 60,
        max: 5,
      },
    ],
    hooks: {
      after: [
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
