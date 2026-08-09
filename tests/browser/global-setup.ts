import type { FullConfig } from "@playwright/test";
import { Client } from "pg";

import { adminEmail, startMagicLinkWebhook, stopMagicLinkWebhook } from "./fixtures/magic-link-webhook";
import { randomUUID } from "node:crypto";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

/**
 * Creates the shared admin account every authenticated spec signs in as.
 *
 * Better Auth creates the row on the first magic-link sign-in, so on a freshly
 * reset database two workers that sign in at the same time both insert it and
 * one loses to the `user.email` unique constraint — the sign-in fails and the
 * spec lands back on the login page. Seeding it once here removes the race;
 * a run against an already-seeded database is unaffected.
 */
async function ensureAdminUser(): Promise<void> {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    await database.query(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "updatedAt")
       VALUES ($1, 'Admin', $2, true, NOW())
       ON CONFLICT ("email") DO NOTHING`,
      [randomUUID(), adminEmail],
    );
  } finally {
    await database.end();
  }
}

/**
 * Starts the one magic-link webhook broker the whole browser suite shares, and
 * returns Playwright's global teardown for it. No spec may bind its own
 * listener: they all run against the single AUTH_MAGIC_LINK_WEBHOOK_URL the web
 * server is configured with.
 */
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  await ensureAdminUser();
  const webhook = await startMagicLinkWebhook();
  return () => stopMagicLinkWebhook(webhook);
}
