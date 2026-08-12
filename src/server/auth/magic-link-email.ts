import "server-only";

import { resendSenderAddress } from "@/server/infrastructure/resend-email";

export interface MagicLinkMessage {
  readonly email: string;
  readonly url: string;
}

export type SendMagicLink = (message: MagicLinkMessage) => Promise<void>;

export interface MagicLinkWording {
  readonly subject: string;
  readonly textIntro: string;
  readonly htmlIntro: string;
  readonly linkLabel: string;
  readonly htmlExpiry: string;
}

interface MagicLinkDeliveryConfig {
  readonly resendApiKey?: string;
  readonly resendFromEmail?: string;
  readonly webhookToken?: string;
  readonly webhookUrl?: string;
  readonly wording?: MagicLinkWording;
}

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

const SIGN_IN_WORDING: MagicLinkWording = {
  subject: "Sign in to GatherPulse",
  textIntro: "Use this single-use link to sign in. It expires in 10 minutes:",
  htmlIntro: "Use this single-use link to sign in:",
  linkLabel: "Sign in to GatherPulse",
  htmlExpiry: "This link expires in 10 minutes.",
};

async function deliverWithObservability(provider: "resend" | "webhook", email: string, deliver: () => Promise<void>) {
  try {
    await deliver();
  } catch (error) {
    console.error("[auth] Magic-link delivery failed", {
      provider,
      email,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function emailContent(url: string, wording: MagicLinkWording) {
  const escapedUrl = url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

  return {
    subject: wording.subject,
    text: `${wording.textIntro} ${url}`,
    html: `<p>${wording.htmlIntro}</p><p><a href="${escapedUrl}">${wording.linkLabel}</a></p><p>${wording.htmlExpiry}</p>`,
  };
}

export function createConfiguredMagicLinkSender({
  resendApiKey,
  resendFromEmail,
  webhookToken,
  webhookUrl,
  wording = SIGN_IN_WORDING,
}: MagicLinkDeliveryConfig): SendMagicLink {
  return async ({ email, url }) => {
    if (process.env.NODE_ENV === "development") {
      console.info(`[auth] Magic link for ${email}: ${url}`);
      return;
    }

    const content = emailContent(url, wording);

    if (resendApiKey && resendFromEmail) {
      await deliverWithObservability("resend", email, async () => {
        const response = await fetch(RESEND_EMAILS_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${resendApiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: resendSenderAddress(resendFromEmail),
            to: [email],
            ...content,
          }),
        });

        if (!response.ok) {
          throw new Error(`Resend rejected magic-link delivery with status ${response.status}`);
        }
      });
      return;
    }

    if (!webhookUrl) {
      throw new Error("Magic-link delivery is not configured.");
    }

    await deliverWithObservability("webhook", email, async () => {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(webhookToken ? { authorization: `Bearer ${webhookToken}` } : {}),
        },
        body: JSON.stringify({
          to: email,
          ...content,
        }),
      });

      if (!response.ok) {
        throw new Error(`Magic-link webhook rejected delivery with status ${response.status}`);
      }
    });
  };
}
