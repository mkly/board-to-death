import { type BrowserContext, expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers/hydration.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface RecipientAudienceFixture {
  readonly eventSlug: string;
  readonly sessionCookie: string;
}

async function prepareAudience(context: BrowserContext): Promise<string> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/recipient-audience.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as RecipientAudienceFixture;
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL }]);
  return fixture.eventSlug;
}

test("previews a deduplicated live audience with exact recipients and explained exclusions", async ({
  context,
  page,
}) => {
  const eventSlug = await prepareAudience(context);
  await page.goto(`/dashboard/events/${eventSlug}/communications/audience`);

  await expect(page.getByRole("heading", { name: "Recipient audience" })).toBeVisible();
  await waitForHydration(page.getByRole("checkbox", { name: "Ada Lovelace" }));
  await page.getByRole("checkbox", { name: "Ada Lovelace" }).check();
  await page.getByRole("checkbox", { name: "Accepted" }).check();
  await page.getByRole("checkbox", { name: "Opening keynote" }).check();
  await page.getByRole("checkbox", { name: "Game design" }).check();
  await page.getByRole("checkbox", { name: "Approved" }).check();
  await page.getByRole("button", { name: "Preview audience" }).click();

  // The count renders in a CardTitle, which is a div in this shadcn style rather than a heading.
  await expect(page.getByText("2 eligible recipients", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Ada Lovelace/ })).toHaveCount(1);
  await expect(page.getByRole("row", { name: /Ada Lovelace/ })).toContainText("Selected directly");
  await expect(page.getByRole("row", { name: /Grace Hopper/ })).toContainText("Onboarding approved");
  await expect(page.getByRole("row", { name: /Lin Speaker/ })).toContainText("Email consent is not active");
  await expect(page.getByText("Ready for confirmation")).toBeVisible();

  await page.getByRole("combobox", { name: "Email template" }).click();
  await page.getByRole("option", { name: "Speaker update · v1" }).click();
  await page.getByRole("button", { name: "Confirm 2 recipients" }).click();
  await expect(page.getByRole("alertdialog", { name: "Queue this bulk send?" })).toBeVisible();
  await page.getByRole("button", { name: "Queue recipient deliveries" }).click();
  await expect(page.getByRole("alert")).toContainText("2 recipient deliveries queued from immutable snapshots.");

  await page.getByRole("link", { name: "View delivery details" }).click();
  await expect(page.getByRole("heading", { name: "Bulk delivery" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Ada Lovelace/ })).toContainText("Hello Ada Lovelace");
  await page.getByRole("button", { name: "Cancel remaining attempts" }).click();
  await expect(page.getByRole("alertdialog", { name: "Cancel this delivery?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel remaining attempts", exact: true }).last().click();
  await expect(page.getByText(/Cancelled/)).toBeVisible();

  await page.getByRole("link", { name: "Back to audience" }).click();

  await page.getByRole("link", { name: "Clear" }).click();
  await page.getByRole("checkbox", { name: "Rejected" }).check();
  await page.getByRole("button", { name: "Preview audience" }).click();
  await expect(page.getByText("0 eligible recipients", { exact: true })).toBeVisible();
  await expect(page.getByText("No currently eligible speaker matches the selected criteria.")).toBeVisible();
});
