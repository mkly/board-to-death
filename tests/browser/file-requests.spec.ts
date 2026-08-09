import { type BrowserContext, expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface FileRequestFixture {
  readonly eventSlug: string;
  readonly sessionCookie: string;
  readonly contactId: string;
  readonly contactLabel: string;
}

async function prepareFileRequests(context: BrowserContext): Promise<FileRequestFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/file-requests.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as FileRequestFixture;
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL }]);
  return fixture;
}

test("creates, assigns, edits, withdraws, and archives an event-scoped file request", async ({ context, page }) => {
  test.setTimeout(90_000);
  const fixture = await prepareFileRequests(context);
  const indexPath = `/dashboard/events/${fixture.eventSlug}/file-requests`;

  await page.goto(indexPath);
  await expect(page.getByRole("heading", { name: "File Requests" })).toBeVisible();
  await expect(page.getByText("No file requests yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Export all files" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add file request" }).click();
  await expect(page.getByRole("heading", { name: "Add file request" })).toBeVisible();
  await page.getByLabel("Title").fill("Signed Sponsor Contract");
  await page.getByLabel("Instructions").fill("Return the countersigned PDF.");
  await page.getByLabel("Due before the event starts").fill("14");
  await page.getByLabel("PDF", { exact: true }).check();
  await page.getByLabel("Maximum size (MB)").fill("5");
  await page.getByRole("button", { name: "Create file request" }).click();

  // Creating lands on the request's own screen, where the captured upload rules are shown.
  await expect(page.getByRole("heading", { name: "Signed Sponsor Contract" })).toBeVisible();
  await expect(page.getByText("File request created.")).toBeVisible();
  await expect(page.getByText("version 1")).toBeVisible();
  await expect(page.getByText("5 MB")).toBeVisible();
  await expect(page.getByText("14 days before the event starts")).toBeVisible();
  await expect(page.getByText("Return the countersigned PDF.")).toBeVisible();
  await expect(page.getByText("Nothing assigned yet")).toBeVisible();

  await page.getByLabel("Target").selectOption({ label: `${fixture.contactLabel} — Reed Robotics` });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(`${fixture.contactLabel}.*pending`) })).toBeVisible();
  await expect(page.getByText("version 1 · 5 MB max")).toBeVisible();

  // Editing appends a version; the existing assignment keeps the rules it captured.
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Maximum size (MB)").fill("20");
  await page.getByRole("button", { name: "Save file request" }).click();
  await expect(page.getByText("version 2")).toBeVisible();
  await expect(page.getByText("version 1 · 5 MB max")).toBeVisible();

  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`${fixture.contactLabel}.*withdrawn`) })).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw" })).toHaveCount(0);

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page).toHaveURL(new RegExp(`${fixture.eventSlug}/file-requests\\?notice=`));
  const row = page.getByRole("row", { name: /Signed Sponsor Contract/ });
  await expect(row.getByText("Archived")).toBeVisible();
  // A withdrawn assignment leaves the active counts.
  await expect(row.getByText("0/0")).toBeVisible();

  await page.getByRole("link", { name: "Group Requests" }).click();
  await expect(page.getByText("No file requests match this type.")).toBeVisible();
  await page.getByRole("link", { name: "Contact Requests" }).click();
  await expect(page.getByRole("row", { name: /Signed Sponsor Contract/ })).toBeVisible();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("File request restored.")).toBeVisible();
  await page.getByRole("link", { name: "Manage" }).click();
  await expect(page.getByRole("heading", { name: "Signed Sponsor Contract" })).toBeVisible();
  await expect(page.getByText("Archived")).toHaveCount(0);
});
