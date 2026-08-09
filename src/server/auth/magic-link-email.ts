import "server-only";

export interface MagicLinkMessage {
  readonly email: string;
  readonly url: string;
}

export type SendMagicLink = (message: MagicLinkMessage) => Promise<void>;

interface MagicLinkDeliveryConfig {
  readonly resendApiKey?: string;
  readonly resendFromEmail?: string;
  readonly webhookToken?: string;
  readonly webhookUrl?: string;
}

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

function emailContent(url: string) {
  const escapedUrl = url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

  return {
    subject: "Sign in to Board to Death",
    text: `Use this single-use link to sign in. It expires in 10 minutes: ${url}`,
    html: `<p>Use this single-use link to sign in:</p><p><a href="${escapedUrl}">Sign in to Board to Death</a></p><p>This link expires in 10 minutes.</p>`,
  };
}

export function createConfiguredMagicLinkSender({
  resendApiKey,
  resendFromEmail,
  webhookToken,
  webhookUrl,
}: MagicLinkDeliveryConfig): SendMagicLink {
  return async ({ email, url }) => {
    const content = emailContent(url);

    if (resendApiKey && resendFromEmail) {
      const response = await fetch(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${resendApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: `Board to Death <${resendFromEmail}>`,
          to: [email],
          ...content,
        }),
      });

      if (!response.ok) {
        throw new Error(`Resend rejected magic-link delivery with status ${response.status}`);
      }
      return;
    }

    if (!webhookUrl) {
      console.info(`[auth] Magic link for ${email}: ${url}`);
      return;
    }

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
  };
}
