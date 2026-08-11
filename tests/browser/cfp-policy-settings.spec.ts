import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./helpers/hydration.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface CfpPolicyFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly formId: string;
  readonly sessionCookie: string;
}

async function selectDateTime(
  page: Page,
  label: string,
  date: { readonly year: string; readonly month: string; readonly day: string; readonly time: string },
): Promise<void> {
  await page.getByRole("button", { name: label }).click();
  await page.locator('select[aria-label="Choose the Year"]:visible').selectOption({ label: date.year });
  await page.locator('select[aria-label="Choose the Month"]:visible').selectOption({ label: date.month });
  await page.getByRole("button", { name: date.day }).click();
  await page.locator('input[type="time"]:visible').fill(date.time);
  await page.getByRole("button", { name: "Done" }).click();
}

async function prepareCfpPolicy(context: BrowserContext): Promise<CfpPolicyFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/cfp-policy-settings.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as CfpPolicyFixture;
  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL },
    {
      name: "gatherpulse_active_event",
      value: fixture.eventId,
      domain: "127.0.0.1",
      path: "/dashboard",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return fixture;
}

test("validates, saves, and restores event-time-zone CFP submission settings", async ({ context, page }) => {
  const fixture = await prepareCfpPolicy(context);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/cfp/forms/${fixture.formId}/setup`);

  await expect(page.getByRole("heading", { name: "Board Game Design CFP" })).toBeVisible();
  await expect(page.getByText("America/Los_Angeles", { exact: true })).toBeVisible();
  await waitForHydration(page.getByLabel("Opens at"));

  await selectDateTime(page, "Opens at", {
    year: "2027",
    month: "Mar",
    day: "Sunday, March 14th, 2027",
    time: "02:30",
  });
  await selectDateTime(page, "Closes at", {
    year: "2027",
    month: "Mar",
    day: "Sunday, March 14th, 2027",
    time: "04:00",
  });
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Enter a valid date and time in America/Los_Angeles.")).toBeVisible();

  await selectDateTime(page, "Opens at", {
    year: "2027",
    month: "Mar",
    day: "Sunday, March 14th, 2027",
    time: "01:30",
  });
  await selectDateTime(page, "Closes at", {
    year: "2028",
    month: "Apr",
    day: "Sunday, April 30th, 2028",
    time: "03:30",
  });
  await page.getByRole("radio", { name: "Start as draft" }).click();
  await page.getByLabel("Submissions per speaker").fill("5");
  await page.getByLabel("Participants per submission").fill("6");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Submission settings saved.")).toBeVisible();

  await page.reload();
  await expect(page.locator('input[name="submissionOpensAt"]')).toHaveValue("2027-03-14T01:30");
  await expect(page.locator('input[name="submissionClosesAt"]')).toHaveValue("2028-04-30T03:30");
  await expect(page.getByRole("radio", { name: "Start as draft" })).toBeChecked();
  await expect(page.getByLabel("Submissions per speaker")).toHaveValue("5");
  await expect(page.getByLabel("Participants per submission")).toHaveValue("6");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
});
