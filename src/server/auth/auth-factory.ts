import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";

import type { PrismaClient } from "@/generated/prisma/client";

import type { SendMagicLink } from "./magic-link-email";

interface CreateAuthOptions {
  readonly baseURL: string;
  readonly database: PrismaClient;
  readonly isAllowedEmail: (email: string) => boolean | Promise<boolean>;
  readonly secret: string;
  readonly sendMagicLink: SendMagicLink;
}

export function createAuth({ baseURL, database, isAllowedEmail, secret, sendMagicLink }: CreateAuthOptions) {
  return betterAuth({
    appName: "Board to Death",
    baseURL,
    database: prismaAdapter(database, { provider: "postgresql" }),
    secret,
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          if (await isAllowedEmail(email)) {
            await sendMagicLink({ email, url });
          }
        },
      }),
      nextCookies(),
    ],
  });
}
