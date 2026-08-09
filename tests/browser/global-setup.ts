import type { FullConfig } from "@playwright/test";

import { startMagicLinkWebhook, stopMagicLinkWebhook } from "./fixtures/magic-link-webhook";

/**
 * Starts the one magic-link webhook broker the whole browser suite shares, and
 * returns Playwright's global teardown for it. No spec may bind its own
 * listener: they all run against the single AUTH_MAGIC_LINK_WEBHOOK_URL the web
 * server is configured with.
 */
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const webhook = await startMagicLinkWebhook();
  return () => stopMagicLinkWebhook(webhook);
}
