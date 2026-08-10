import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface FulfillmentFixture {
  readonly contactToken: string;
  readonly groupToken: string;
  readonly otherToken: string;
}

async function prepareFulfillment(): Promise<FulfillmentFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/file-request-fulfillment.ts"],
    { env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
  return JSON.parse(stdout) as FulfillmentFixture;
}

test("contact and group assignees fulfill an event-isolated request through a single-use link", async ({ page }) => {
  const fixture = await prepareFulfillment();
  const contactPath = `/file-requests/${encodeURIComponent(fixture.contactToken)}`;

  await page.goto(contactPath);
  await expect(page.getByRole("heading", { name: "Upload a requested file" })).toBeVisible();
  await expect(page.getByText("Signed sponsor contract")).toBeVisible();
  await expect(page.getByText("Return the countersigned PDF.")).toBeVisible();
  await expect(page.getByText("application/pdf · 5 MB maximum")).toBeVisible();
  await expect(page.getByText("Other event private tax form")).toHaveCount(0);
  await expect(page.getByText("Fulfillment Summit")).toHaveCount(0);

  await page.getByLabel("File").setInputFiles({
    name: "not-a-pdf.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf"),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByText("The file's contents do not match its declared type.")).toBeVisible();

  await page.getByLabel("File").setInputFiles({
    name: "signed-contract.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7"),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByText("Upload complete", { exact: true })).toBeVisible();

  await page.goto(contactPath);
  await expect(page.getByText("This fulfillment link is not available")).toBeVisible();

  await page.goto(`/file-requests/${encodeURIComponent(fixture.groupToken)}`);
  await expect(page.getByText("Sponsor logo pack")).toBeVisible();
  await page.getByLabel("File").setInputFiles({
    name: "sponsor-logo.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7"),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByText("Upload complete", { exact: true })).toBeVisible();

  await page.goto(`/file-requests/${encodeURIComponent(fixture.otherToken)}`);
  await expect(page.getByText("Other event private tax form")).toBeVisible();
  await expect(page.getByText("Signed sponsor contract")).toHaveCount(0);
});
