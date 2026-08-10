import "server-only";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { getDatabaseClient } from "@/server/database/client";

import { createAuth } from "./auth-factory";
import { createConfiguredMagicLinkSender } from "./magic-link-email";

const runtimeConfig = getRuntimeConfig().server;
const database = getDatabaseClient();

export const auth = createAuth({
  baseURL: runtimeConfig.BETTER_AUTH_URL,
  database,
  secret: runtimeConfig.BETTER_AUTH_SECRET,
  sendMagicLink: createConfiguredMagicLinkSender({
    resendApiKey: runtimeConfig.RESEND_API_KEY,
    resendFromEmail: runtimeConfig.RESEND_FROM_EMAIL,
    webhookToken: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_TOKEN,
    webhookUrl: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_URL,
  }),
});
