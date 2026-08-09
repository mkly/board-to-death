import { type BrowserContext, expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface OnboardingFixture {
  readonly eventSlug: string;
  readonly sessionCookie: string;
}

async function prepareOnboarding(context: BrowserContext): Promise<string> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/onboarding.ts"],
    {
      env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl },
    },
  );
  const fixture = JSON.parse(stdout) as OnboardingFixture;
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL }]);
  return fixture.eventSlug;
}

test("assigns an accepted-speaker cohort, deduplicates it, changes a due date, and withdraws work", async ({
  context,
  page,
}) => {
  const eventSlug = await prepareOnboarding(context);
  await page.goto(`/dashboard/events/${eventSlug}/onboarding`);

  await expect(page.getByRole("heading", { name: "Speaker onboarding" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Ada Lovelace" }).check();
  await page.getByRole("checkbox", { name: "Grace Hopper" }).check();
  await page.getByLabel("Due date", { exact: true }).fill("2027-04-30");
  await page.getByRole("button", { name: "Assign selected" }).click();
  await expect(page.getByLabel("Active assignment count")).toHaveText("2");

  await page.getByRole("checkbox", { name: "Ada Lovelace" }).check();
  await page.getByRole("checkbox", { name: "Grace Hopper" }).check();
  await page.getByRole("button", { name: "Assign selected" }).click();
  await expect(page.getByLabel("Active assignment count")).toHaveText("2");

  const adaRow = page.getByRole("row", { name: /Ada Lovelace/ });
  await adaRow.getByLabel("Due date for Ada Lovelace").fill("2027-05-02");
  await adaRow.getByRole("button", { name: "Save due date for Ada Lovelace" }).click();
  await expect(page.getByRole("row", { name: /Ada Lovelace/ }).getByLabel("Due date for Ada Lovelace")).toHaveValue(
    "2027-05-02",
  );

  await page
    .getByRole("row", { name: /Ada Lovelace/ })
    .getByRole("button", { name: "Withdraw task for Ada Lovelace" })
    .click();
  await expect(page.getByRole("row", { name: /Ada Lovelace/ })).toContainText("Withdrawn");
});
