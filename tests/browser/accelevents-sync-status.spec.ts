import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/accelevents-sync-status.ts");

interface BrowserFixture {
  readonly eventAId: string;
  readonly eventASlug: string;
  readonly eventBId: string;
  readonly eventBSlug: string;
  readonly eventCId: string;
  readonly eventCSlug: string;
  readonly eventDId: string;
  readonly eventDSlug: string;
  readonly runActiveId: string;
  readonly runCancelledId: string;
  readonly runMixedId: string;
  readonly runThrottledId: string;
  readonly runCredentialId: string;
  readonly runToRetryId: string;
  readonly credentialReference: string;
  readonly sessionToken: string;
}

async function runFixture(action: "setup" | "cleanup", ...eventIds: readonly string[]): Promise<BrowserFixture | null> {
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript, action, ...eventIds], {
    env: process.env,
  });
  return action === "setup" ? (JSON.parse(stdout) as BrowserFixture) : null;
}

test.describe("Accelevents sync status", () => {
  test.describe.configure({ mode: "serial" });
  let fixture: BrowserFixture;

  test.beforeAll(async () => {
    const created = await runFixture("setup");
    if (!created) throw new Error("Expected the Accelevents sync status browser fixture to be created.");
    fixture = created;
  });

  test.afterAll(async () => {
    if (fixture) await runFixture("cleanup", fixture.eventAId, fixture.eventBId, fixture.eventCId, fixture.eventDId);
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "better-auth.session_token", value: fixture.sessionToken, url: baseURL },
      { name: "gatherpulse_active_event", value: fixture.eventAId, url: baseURL },
    ]);
  });

  test("shows active progress and lets an admin request cancellation", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventDSlug}/integrations`);
    const region = page.getByRole("region", { name: "Accelevents sync status" });
    await expect(region).toBeVisible();

    const card = page.getByTestId(`sync-run-${fixture.runActiveId}`);
    await expect(card.getByText("Running", { exact: true })).toBeVisible();
    await expect(card.getByText("active-succeeded")).toBeVisible();
    await expect(card.getByText("active-pending")).toBeVisible();
    await expect(card.getByRole("button", { name: /Retry \d+ eligible/ })).toHaveCount(0);

    await card.getByRole("button", { name: "Cancel run" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel run" }).click();

    await expect(card.getByText("Cancellation requested")).toBeVisible();
    await expect(card.getByRole("button", { name: "Cancel run" })).toHaveCount(0);
  });

  test("shows a cancelled run's final record outcomes", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventASlug}/integrations`);
    const card = page.getByTestId(`sync-run-${fixture.runCancelledId}`);
    await expect(card.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(card.getByText("cancel-succeeded")).toBeVisible();
    await expect(card.getByText("cancel-skipped")).toBeVisible();
    await expect(card.getByRole("button", { name: "Cancel run" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Retry \d+ eligible/ })).toHaveCount(0);
  });

  test("explains mixed outcomes with redacted, human-readable failure reasons", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventASlug}/integrations`);
    const card = page.getByTestId(`sync-run-${fixture.runMixedId}`);
    await expect(card.getByText("Partially failed", { exact: true })).toBeVisible();

    const succeededRow = card.getByRole("row").filter({ hasText: "mixed-succeeded" });
    await expect(succeededRow.getByText("Succeeded", { exact: true })).toBeVisible();

    const invalidEmailRow = card.getByRole("row").filter({ hasText: "mixed-invalid-email" });
    await expect(invalidEmailRow.getByText("Validation failed")).toBeVisible();
    await expect(invalidEmailRow.getByText("The speaker's email address is invalid.")).toBeVisible();

    const unauthorizedRow = card.getByRole("row").filter({ hasText: "mixed-unauthorized" });
    await expect(unauthorizedRow.getByText("Failed", { exact: true })).toBeVisible();
    await expect(unauthorizedRow.getByText("The service rejected its credentials.")).toBeVisible();

    const rateLimitedRow = card.getByRole("row").filter({ hasText: "mixed-rate-limited" });
    await expect(rateLimitedRow.getByText("Retriable failure")).toBeVisible();
    await expect(rateLimitedRow.getByText("The service rate limit was reached.")).toBeVisible();
    await expect(rateLimitedRow.getByText(/Retry after/)).toBeVisible();
  });

  test("keeps throttled failures ineligible until their retry window elapses", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventASlug}/integrations`);
    const card = page.getByTestId(`sync-run-${fixture.runThrottledId}`);
    await expect(card.getByText("Partially failed", { exact: true })).toBeVisible();

    const limitedRow = card.getByRole("row").filter({ hasText: "throttle-limited" });
    await expect(limitedRow.getByText("Retriable failure")).toBeVisible();
    await expect(limitedRow.getByText("The service rate limit was reached.")).toBeVisible();
    await expect(limitedRow.getByText(/Retry after/)).toBeVisible();
    await expect(card.getByRole("button", { name: /Retry \d+ eligible/ })).toHaveCount(0);
  });

  test("surfaces credential failures without exposing the credential", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventASlug}/integrations`);
    const card = page.getByTestId(`sync-run-${fixture.runCredentialId}`);
    await expect(card.getByText("Failed", { exact: true }).first()).toBeVisible();

    const failRow1 = card.getByRole("row").filter({ hasText: "cred-fail-1" });
    await expect(failRow1.getByText("The service rejected its credentials.")).toBeVisible();
    const failRow2 = card.getByRole("row").filter({ hasText: "cred-fail-2" });
    await expect(failRow2.getByText("The service rejected its credentials.")).toBeVisible();

    await expect(card.getByRole("button", { name: /Retry \d+ eligible/ })).toHaveCount(0);
    await expect(page.getByText(fixture.credentialReference)).toHaveCount(0);
    await expect(page.getByText("runtime-preview-key")).toHaveCount(0);
  });

  test("retries only the eligible record and links it back to the original attempt", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventASlug}/integrations`);
    const card = page.getByTestId(`sync-run-${fixture.runToRetryId}`);
    await expect(card.getByText("Partially failed", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Retry 1 eligible" })).toBeVisible();

    await card.getByRole("button", { name: "Retry 1 eligible" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Retry eligible records" }).click();

    await expect(card.getByRole("row").filter({ hasText: "Already retried" })).toBeVisible();
    await expect(card.getByRole("button", { name: /Retry \d+ eligible/ })).toHaveCount(0);

    const retriedRunCards = page
      .locator('[data-testid^="sync-run-"]')
      .filter({ has: page.getByText("retry", { exact: true }) });
    await expect(retriedRunCards).toHaveCount(1);
    await expect(retriedRunCards.getByText("Succeeded", { exact: true }).first()).toBeVisible();
  });

  test("keeps sync history scoped to its own event", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventASlug}/integrations`);
    await expect(page.getByText("crossb-only-record")).toHaveCount(0);

    await page.goto(`/dashboard/events/${fixture.eventBSlug}/integrations`);
    const region = page.getByRole("region", { name: "Accelevents sync status" });
    await expect(region).toBeVisible();
    await expect(page.getByText("crossb-only-record")).toBeVisible();
    await expect(page.getByText("mixed-invalid-email")).toHaveCount(0);
    await expect(page.getByText("active-pending")).toHaveCount(0);
  });

  test("shows an empty state when no runs exist yet", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventCSlug}/integrations`);
    const region = page.getByRole("region", { name: "Accelevents sync status" });
    await expect(region).toBeVisible();
    await expect(region.getByText("No sync runs yet")).toBeVisible();
    await expect(page.locator('[data-testid^="sync-run-"]')).toHaveCount(0);
  });
});
