import { type BrowserContext, expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface ContactDirectoryFixture {
  readonly activeEventId: string;
  readonly eventSlug: string;
  readonly personId: string;
  readonly sessionCookie: string;
}

async function prepareContactDirectory(context: BrowserContext): Promise<ContactDirectoryFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/contact-directory.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as ContactDirectoryFixture;
  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL },
    { name: "board_to_death_active_event", value: fixture.activeEventId, url: baseURL },
  ]);
  return fixture;
}

test("merges a duplicate, links the returning contact, and shows event history", async ({ context, page }) => {
  const fixture = await prepareContactDirectory(context);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/contacts`);

  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByText("Possible duplicates", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compare and merge" }).click();
  const mergeDialog = page.getByRole("alertdialog", { name: "Merge these duplicate people?" });
  await expect(mergeDialog.getByText("dana.alt@example.test")).toBeVisible();
  await expect(mergeDialog.getByText("dana@example.test")).toBeVisible();
  await mergeDialog.getByRole("radio", { name: /dana@example\.test/ }).check();
  await expect(mergeDialog.getByText("This merge cannot be undone")).toBeVisible();
  await mergeDialog.getByRole("button", { name: "Merge records" }).click();
  await expect(page.getByText("Duplicate people merged into one record.")).toBeVisible();
  await expect(page.getByText("Possible duplicates", { exact: true })).toHaveCount(0);

  await expect(page.getByText("No contacts in this event")).toBeVisible();
  await page.getByLabel("Search directory").fill("Reed Robotics");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.getByRole("row", { name: /Dana Reed.*Reed Robotics/ })).toBeVisible();

  await page.getByRole("button", { name: "Add to event" }).click();
  await expect(page.getByText("Contact added from the directory.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Dana Reed.*Directory/ })).toBeVisible();

  await page.getByRole("link", { name: "Dana Reed" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${fixture.personId}$`));
  await expect(page.getByRole("heading", { name: "Dana Reed" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Directory Origins.*New/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Directory Return.*Returning/ })).toBeVisible();
});
