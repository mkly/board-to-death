import { type BrowserContext, expect, test } from "@playwright/test";

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
      name: "board_to_death_active_event",
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

  await page.getByLabel("Opens at").fill("2027-03-14T02:30");
  await page.getByLabel("Closes at").fill("2027-03-14T04:00");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Enter a valid date and time in America/Los_Angeles.")).toBeVisible();

  await page.getByLabel("Opens at").fill("2027-03-14T01:30");
  await page.getByLabel("Closes at").fill("2027-03-14T03:30");
  await page.getByRole("radio", { name: "Start as draft" }).click();
  await page.getByLabel("Submissions per speaker").fill("5");
  await page.getByLabel("Participants per submission").fill("6");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Submission settings saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Opens at")).toHaveValue("2027-03-14T01:30");
  await expect(page.getByLabel("Closes at")).toHaveValue("2027-03-14T03:30");
  await expect(page.getByRole("radio", { name: "Start as draft" })).toBeChecked();
  await expect(page.getByLabel("Submissions per speaker")).toHaveValue("5");
  await expect(page.getByLabel("Participants per submission")).toHaveValue("6");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
});
