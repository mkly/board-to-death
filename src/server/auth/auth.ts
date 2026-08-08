import "server-only";

import { getDatabaseClient } from "@/server/database/client";

import { getAllowedAdminEmails, isAllowedAdminEmail } from "./admin-access";
import { createAuth } from "./auth-factory";
import { sendConfiguredMagicLink } from "./magic-link-email";

const allowedAdminEmails = getAllowedAdminEmails();

export const auth = createAuth({
  database: getDatabaseClient(),
  isAllowedEmail: (email) => isAllowedAdminEmail(email, allowedAdminEmails),
  sendMagicLink: sendConfiguredMagicLink,
});
