import "server-only";

export interface MagicLinkMessage {
  readonly email: string;
  readonly url: string;
}

export type SendMagicLink = (message: MagicLinkMessage) => Promise<void>;

interface MagicLinkDeliveryConfig {
  readonly webhookToken?: string;
  readonly webhookUrl?: string;
}

export function createConfiguredMagicLinkSender({ webhookToken, webhookUrl }: MagicLinkDeliveryConfig): SendMagicLink {
  return async ({ email, url }) => {
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
        subject: "Sign in to Board to Death",
        text: `Use this single-use link to sign in. It expires in 10 minutes: ${url}`,
        html: `<p>Use this single-use link to sign in:</p><p><a href="${url}">Sign in to Board to Death</a></p><p>This link expires in 10 minutes.</p>`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Magic-link webhook rejected delivery with status ${response.status}`);
    }
  };
}
