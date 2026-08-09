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
  await adaRow.getByLabel("Due date for Ada Lovelace", { exact: true }).fill("2027-05-02");
  await adaRow.getByRole("button", { name: "Save due date for Ada Lovelace" }).click();
  await expect(
    page.getByRole("row", { name: /Ada Lovelace/ }).getByLabel("Due date for Ada Lovelace", { exact: true }),
  ).toHaveValue("2027-05-02");

  await page
    .getByRole("row", { name: /Ada Lovelace/ })
    .getByRole("button", { name: "Withdraw task for Ada Lovelace" })
    .click();
  await expect(page.getByRole("row", { name: /Ada Lovelace/ })).toContainText("Withdrawn");
});

test("authors a task form condition against an earlier field", async ({ context, page }) => {
  await prepareOnboarding(context);
  await page.goto("/dashboard/onboarding-tasks");

  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog", { name: "Create onboarding task" });
  await dialog.getByLabel("Task title").fill("Collect travel needs");
  await dialog.getByLabel("Required response").click();
  await page.getByRole("option", { name: "Response form" }).click();
  await dialog
    .getByLabel("Sections and fields")
    .fill(
      "[Travel]\nI need travel help | checkbox | optional | needs-travel-help\nTravel details | textarea | required | | when I need travel help = checked",
    );
  await dialog.getByRole("button", { name: "Create task" }).click();

  const task = page.getByText("Collect travel needs").locator("xpath=ancestor::*[@data-slot='card'][1]");
  await expect(task).toContainText("Response form");
  await task.getByRole("button", { name: "Edit" }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit onboarding task" }).getByLabel("Sections and fields"),
  ).toHaveValue(/when I need travel help = checked/);
});
