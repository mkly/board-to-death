import { type BrowserContext, expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface CfpMessageFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly formId: string;
  readonly sessionCookie: string;
}

async function prepareCfpMessages(context: BrowserContext): Promise<CfpMessageFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/cfp-message-settings.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as CfpMessageFixture;
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

test("previews, validates, saves, disables, and reloads CFP message settings", async ({ context, page }) => {
  test.setTimeout(90_000);
  const fixture = await prepareCfpMessages(context);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/cfp/forms/${fixture.formId}/setup`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("tab", { name: "Messages" }).click();

  await expect(page.getByText("Applicant messages", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Draft reminders" })).not.toBeChecked();
  await expect(page.getByLabel("Days before close")).toBeDisabled();
  await expect(page.getByText("Board to Death 2027", { exact: true }).first()).toBeVisible();

  await page.getByRole("switch", { name: "Draft reminders" }).click();
  await page.getByLabel("Days before close").fill("0");
  await page.getByLabel("Days before close").evaluate((element) => element.removeAttribute("min"));
  await page.getByLabel("Submission confirmation").fill("<script>alert('no')</script>");
  await page.getByLabel("Thank-you message").fill("Your session is {{proposal.title}}.");
  await page.getByRole("button", { name: "Save messages" }).click();
  await expect(page.getByText("Choose a whole number from 1 to 90 days.")).toBeVisible();
  await expect(page.locator("form").getByText(/Raw HTML is not allowed/)).toBeVisible();
  await expect(page.locator("form").getByText(/Unknown variables: proposal.title/)).toBeVisible();

  await page.getByRole("switch", { name: "Draft reminders" }).click();
  await page.getByLabel("Days before close").fill("5");
  await page.getByLabel("Event-local send time").fill("10:15");
  await page
    .getByLabel("Submission confirmation")
    .fill("We received your proposal for **{{event.name}}** at {{recipient.email}}.");
  await page.getByLabel("Thank-you message").fill("Thank you, {{recipient.name}}, for your proposal.");
  await page.getByRole("button", { name: "Save messages" }).click();
  await expect(page.getByText("Message settings saved.")).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Messages" }).click();
  await expect(page.getByRole("switch", { name: "Draft reminders" })).toBeChecked();
  await expect(page.getByLabel("Days before close")).toHaveValue("5");
  await expect(page.getByLabel("Event-local send time")).toHaveValue("10:15");
  await expect(page.getByLabel("Thank-you message")).toHaveValue("Thank you, {{recipient.name}}, for your proposal.");
});
