import "server-only";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { EvaluationReviewerStatus } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/server/database/client";

import { getAllowedAdminEmails, isAllowedAdminEmail } from "./admin-access";
import { createAuth } from "./auth-factory";
import { createConfiguredMagicLinkSender } from "./magic-link-email";

const runtimeConfig = getRuntimeConfig().server;
const allowedAdminEmails = getAllowedAdminEmails(runtimeConfig.AUTH_ALLOWED_EMAILS);
const database = getDatabaseClient();

async function isAllowedWorkspaceEmail(email: string): Promise<boolean> {
  if (isAllowedAdminEmail(email, allowedAdminEmails)) return true;
  const reviewer = await database.evaluationReviewer.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" }, status: EvaluationReviewerStatus.ACTIVE },
    select: { id: true },
  });
  return reviewer !== null;
}

export const auth = createAuth({
  baseURL: runtimeConfig.BETTER_AUTH_URL,
  database,
  isAllowedEmail: isAllowedWorkspaceEmail,
  secret: runtimeConfig.BETTER_AUTH_SECRET,
  sendMagicLink: createConfiguredMagicLinkSender({
    resendApiKey: runtimeConfig.RESEND_API_KEY,
    resendFromEmail: runtimeConfig.RESEND_FROM_EMAIL,
    webhookToken: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_TOKEN,
    webhookUrl: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_URL,
  }),
});
