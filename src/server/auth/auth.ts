import "server-only";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { getDatabaseClient } from "@/server/database/client";

import { getAllowedAdminEmails, isAllowedAdminEmail } from "./admin-access";
import { createAuth } from "./auth-factory";
import { createConfiguredMagicLinkSender } from "./magic-link-email";

const runtimeConfig = getRuntimeConfig().server;
const allowedAdminEmails = getAllowedAdminEmails(runtimeConfig.AUTH_ALLOWED_EMAILS);

export const auth = createAuth({
  baseURL: runtimeConfig.BETTER_AUTH_URL,
  database: getDatabaseClient(),
  isAllowedEmail: (email) => isAllowedAdminEmail(email, allowedAdminEmails),
  secret: runtimeConfig.BETTER_AUTH_SECRET,
  sendMagicLink: createConfiguredMagicLinkSender({
    resendApiKey: runtimeConfig.RESEND_API_KEY,
    resendFromEmail: runtimeConfig.RESEND_FROM_EMAIL,
    webhookToken: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_TOKEN,
    webhookUrl: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_URL,
  }),
});
