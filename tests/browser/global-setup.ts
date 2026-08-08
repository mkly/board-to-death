import type { FullConfig } from "@playwright/test";

import { startMagicLinkWebhook } from "./fixtures/magic-link-webhook";

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const webhook = await startMagicLinkWebhook();

  return async () => {
    webhook.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      webhook.close((error) => (error ? reject(error) : resolve()));
    });
  };
}
