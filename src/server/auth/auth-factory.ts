import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { magicLink, twoFactor } from "better-auth/plugins";

import type { PrismaClient } from "@/generated/prisma/client";

import type { SendMagicLink } from "./magic-link-email";
import { passwordlessTwoFactor } from "./passwordless-two-factor.ts";

interface CreateAuthOptions {
  readonly baseURL: string;
  readonly database: PrismaClient;
  /** @deprecated Magic-link delivery is no longer gated by an email allowlist. */
  readonly isAllowedEmail?: (email: string) => boolean | Promise<boolean>;
  readonly secret: string;
  readonly sendMagicLink: SendMagicLink;
  readonly twoFactorLockoutDuration?: number;
  readonly twoFactorMaxFailedAttempts?: number;
  readonly twoFactorPeriod?: number;
}

export function createAuth({
  baseURL,
  database,
  secret,
  sendMagicLink,
  twoFactorLockoutDuration,
  twoFactorMaxFailedAttempts,
  twoFactorPeriod,
}: CreateAuthOptions) {
  return betterAuth({
    appName: "GatherPulse",
    baseURL,
    database: prismaAdapter(database, { provider: "postgresql" }),
    secret,
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn: 60 * 10,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          const user = await database.user.findUnique({
            where: { email: email.trim().toLowerCase() },
            select: { id: true },
          });
          if (!user) return;
          await sendMagicLink({ email, url });
        },
      }),
      twoFactor({
        allowPasswordless: true,
        issuer: "GatherPulse",
        accountLockout: {
          maxFailedAttempts: twoFactorMaxFailedAttempts ?? 10,
          durationSeconds: twoFactorLockoutDuration ?? 15 * 60,
        },
        totpOptions: { period: twoFactorPeriod },
      }),
      passwordlessTwoFactor(),
      nextCookies(),
    ],
  });
}
