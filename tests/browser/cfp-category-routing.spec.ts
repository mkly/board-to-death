import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const runFile = promisify(execFile);
let eventSlug = "";
let eventId = "";
let formId = "";
let sessionToken = "";

async function fixture(...arguments_: string[]): Promise<string> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/helpers/cfp-setup-fixture.ts", ...arguments_],
    { env: { ...process.env, TEST_DATABASE_URL: databaseUrl } },
  );
  return stdout.trim();
}

test.describe("CFP category routing", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const setup = JSON.parse(await fixture("categoryRouting", baseURL)) as {
      eventId: string;
      eventSlug: string;
      formId: string;
      sessionToken: string;
    };
    eventId = setup.eventId;
    eventSlug = setup.eventSlug;
    formId = setup.formId;
    sessionToken = setup.sessionToken;
  });

  test.afterAll(async () => {
    await fixture("cleanup", eventSlug);
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: sessionToken,
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "board_to_death_active_event",
        value: eventId,
        url: baseURL,
        sameSite: "Lax",
      },
    ]);
  });

  test("routes matching answers to a category, flags conflicting routes, and survives reload", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/dashboard/events/${eventSlug}/cfp/forms/${formId}/setup`);

    await expect(page.getByText("Category routing", { exact: true })).toBeVisible();
    await expect(page.getByText("No routes configured")).toBeVisible();

    await page.getByRole("button", { name: "Add route" }).click();
    await expect(page.getByText("Route 1", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Target category").first()).toHaveText("Game Design");
    await expect(page.getByLabel("Comparison value").first()).toHaveText("Game design");

    await page.getByRole("button", { name: "Add route" }).click();
    await expect(page.getByText("Route 2", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Target category").last()).toHaveText("Publishing");
    await expect(
      page.getByText("Route 2: this condition conflicts with another route targeting a different category."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save routing" })).toBeDisabled();

    await page.getByLabel("Comparison value").last().click();
    await page.getByRole("option", { name: "Publishing" }).click();
    await expect(
      page.getByText("Route 2: this condition conflicts with another route targeting a different category."),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Save routing" }).click();
    await expect(page.getByText(/Category routing saved as version \d+\./)).toBeVisible();

    await page.reload();
    await expect(page.getByText("Route 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Route 2", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Target category").first()).toHaveText("Game Design");
    await expect(page.getByLabel("Target category").last()).toHaveText("Publishing");
    await expect(page.getByLabel("Comparison value").first()).toHaveText("Game design");
    await expect(page.getByLabel("Comparison value").last()).toHaveText("Publishing");
  });
});
