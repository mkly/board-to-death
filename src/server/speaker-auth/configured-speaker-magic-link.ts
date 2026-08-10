import "server-only";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { createConfiguredMagicLinkSender } from "@/server/auth/magic-link-email";
import { getDatabaseClient } from "@/server/database/client";

import { SpeakerMagicLinkDeliveryService } from "./speaker-magic-link-delivery";

export function createConfiguredSpeakerMagicLinkDelivery(): SpeakerMagicLinkDeliveryService {
  const runtimeConfig = getRuntimeConfig();
  return new SpeakerMagicLinkDeliveryService({
    baseUrl: runtimeConfig.public.NEXT_PUBLIC_APP_URL,
    database: getDatabaseClient(),
    sendMagicLink: createConfiguredMagicLinkSender({
      resendApiKey: runtimeConfig.server.RESEND_API_KEY,
      resendFromEmail: runtimeConfig.server.RESEND_FROM_EMAIL,
      webhookToken: runtimeConfig.server.AUTH_MAGIC_LINK_WEBHOOK_TOKEN,
      webhookUrl: runtimeConfig.server.AUTH_MAGIC_LINK_WEBHOOK_URL,
      wording: {
        subject: "Your speaker portal sign-in link",
        textIntro: "Use this single-use link to sign in to your speaker portal. It expires in 10 minutes:",
        htmlIntro: "Use this single-use link to sign in to your speaker portal:",
        linkLabel: "Sign in to the speaker portal",
        htmlExpiry: "This link expires in 10 minutes.",
      },
    }),
  });
}
