import { type BrowserContext, expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface MatrixFixture {
  readonly eventSlug: string;
  readonly sessionCookie: string;
}

async function prepareMatrix(context: BrowserContext): Promise<MatrixFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/speaker-task-matrix.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as MatrixFixture;
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL }]);
  return fixture;
}

test("filters and exports the event-scoped matrix, follows details, and reflects completion", async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  const fixture = await prepareMatrix(context);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/speakers`);

  await expect(page.getByRole("heading", { name: "Speakers by task" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Ada Lovelace.*Review biography.*Overdue/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Grace Hopper.*Sign agreement.*Not applicable/ })).toBeVisible();
  await expect(page.getByText("Other event secret")).toHaveCount(0);

  await page.getByLabel("State").selectOption("overdue");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/state=overdue/);
  await expect(page.getByRole("row", { name: /Ada Lovelace/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Grace Hopper/ })).toHaveCount(0);
  const exportResponse = await page.request.get(
    await page
      .getByRole("link", { name: "Export filtered CSV" })
      .getAttribute("href")
      .then((href) => href ?? ""),
  );
  expect(exportResponse.ok()).toBe(true);
  expect(exportResponse.headers()["content-disposition"]).toContain("speaker-matrix-summit-speaker-tasks.csv");
  const csv = await exportResponse.text();
  expect(csv).toContain("Ada Lovelace");
  expect(csv).not.toContain("Grace Hopper");

  await page.getByRole("link", { name: "Reset" }).click();
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  await page.getByRole("link", { name: "Back to task matrix" }).click();
  await page.getByRole("link", { name: "Review biography" }).first().click();
  await expect(page.getByRole("heading", { name: "Review biography" })).toBeVisible();

  await page.goto(`/dashboard/events/${fixture.eventSlug}/onboarding`);
  const adaAssignment = page.getByRole("row", { name: /Ada Lovelace Review biography Submitted/ });
  await adaAssignment.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("row", { name: /Ada Lovelace Review biography Approved/ })).toBeVisible();
  await page.goto(`/dashboard/events/${fixture.eventSlug}/speakers?q=Ada`);
  await expect(page.getByRole("row", { name: /Ada Lovelace.*Review biography.*Complete/ })).toBeVisible();
});
