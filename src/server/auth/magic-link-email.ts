import "server-only";

export interface MagicLinkMessage {
  readonly email: string;
  readonly url: string;
}

export type SendMagicLink = (message: MagicLinkMessage) => Promise<void>;

export const sendConfiguredMagicLink: SendMagicLink = async ({ email, url }) => {
  const webhookUrl = process.env.AUTH_MAGIC_LINK_WEBHOOK_URL;

  if (!webhookUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_MAGIC_LINK_WEBHOOK_URL is required in production");
    }

    console.info(`[auth] Magic link for ${email}: ${url}`);
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.AUTH_MAGIC_LINK_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${process.env.AUTH_MAGIC_LINK_WEBHOOK_TOKEN}` }
        : {}),
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
