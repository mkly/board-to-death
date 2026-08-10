import "server-only";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { createConfiguredMagicLinkSender } from "@/server/auth/magic-link-email";

import type { IssuedFileRequestFulfillmentLink } from "./fulfillment-links";

const runtimeConfig = getRuntimeConfig().server;
const sendFulfillmentLink = createConfiguredMagicLinkSender({
  resendApiKey: runtimeConfig.RESEND_API_KEY,
  resendFromEmail: runtimeConfig.RESEND_FROM_EMAIL,
  webhookToken: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_TOKEN,
  webhookUrl: runtimeConfig.AUTH_MAGIC_LINK_WEBHOOK_URL,
  wording: {
    subject: "A file has been requested from you",
    textIntro: "Use this single-use link to upload the requested file. It expires in 7 days:",
    htmlIntro: "Use this single-use link to upload the requested file:",
    linkLabel: "Upload requested file",
    htmlExpiry: "This link expires in 7 days and can be used for one successful upload.",
  },
});

export async function deliverFileRequestFulfillmentLinks(
  links: readonly IssuedFileRequestFulfillmentLink[],
): Promise<void> {
  await Promise.all(
    links.map(async (link) => {
      const url = new URL(`/file-requests/${encodeURIComponent(link.token)}`, runtimeConfig.BETTER_AUTH_URL);
      await sendFulfillmentLink({ email: link.email, url: url.toString() });
    }),
  );
}
