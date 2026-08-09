import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const fixtureScript = "tests/browser/support/submission-fixtures.mts";

interface SeededFixtures {
  readonly emptyEvent: { readonly id: string; readonly slug: string };
  readonly largeEvent: { readonly id: string; readonly slug: string; readonly designCategoryId: string };
}

let fixtures: SeededFixtures;

async function runFixture<T>(command: "seed" | "sign-in" | "cleanup"): Promise<T> {
  const { stdout } = await executeFile(process.execPath, ["--experimental-strip-types", fixtureScript, command], {
    env: process.env,
  });
  const output = stdout.trim().split("\n").at(-1);
  if (!output) throw new Error(`Submission fixture command ${command} produced no result.`);
  return JSON.parse(output) as T;
}

async function signIn(context: import("@playwright/test").BrowserContext) {
  const { value } = await runFixture<{ readonly value: string }>("sign-in");
  await context.addCookies([{ name: "better-auth.session_token", value, url: baseURL }]);
}

async function selectEvent(context: import("@playwright/test").BrowserContext, event: { readonly id: string }) {
  await context.addCookies([{ name: "board_to_death_active_event", value: event.id, url: baseURL }]);
}

test.describe
  .serial("configurable submission table", () => {
    test.beforeAll(async () => {
      fixtures = await runFixture<SeededFixtures>("seed");
    });

    test.beforeEach(async ({ context }) => {
      test.setTimeout(120_000);
      await signIn(context);
    });

    test.afterAll(async () => {
      await runFixture("cleanup");
    });

    test("renders empty and paginated large fixtures and filters from status tabs", async ({ context, page }) => {
      await selectEvent(context, fixtures.emptyEvent);
      await page.goto(`/dashboard/events/${fixtures.emptyEvent.slug}/submissions`);
      await expect(page.getByText("No submissions found")).toBeVisible();

      await selectEvent(context, fixtures.largeEvent);
      await page.goto(`/dashboard/events/${fixtures.largeEvent.slug}/submissions`);
      await expect(page.getByText("Showing 1–20 of 25")).toBeVisible();
      await expect(page.getByRole("link", { name: "Page 1 of 2" })).toBeVisible();
      await page.getByRole("link", { name: "Accepted 1" }).click();
      await expect(page).toHaveURL(/status=ACCEPTED/);
      await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
      await expect(page.getByText("Lex Formula")).toBeVisible();
      await expect(page.getByText("Morgan Review")).toHaveCount(0);
    });

    test("saves a custom-question column for one event and resets it", async ({ context, page }) => {
      await selectEvent(context, fixtures.largeEvent);
      await page.goto(`/dashboard/events/${fixtures.largeEvent.slug}/submissions`);
      await page.getByRole("button", { name: "Columns" }).click();
      await page.getByRole("checkbox", { name: "Audience" }).check();
      await page.getByRole("button", { name: "Save view" }).click();
      await expect(page.getByText("Your table view was saved for this event.")).toBeVisible();

      await page.reload();
      await expect(page.getByRole("columnheader", { name: "Audience" })).toBeVisible();
      await page.getByRole("button", { name: "Columns" }).click();
      await page.getByRole("button", { name: "Reset saved view" }).click();
      await page.reload();
      await expect(page.getByRole("columnheader", { name: "Audience" })).toHaveCount(0);
    });

    test("composes filters and exports only the authorized filtered result set", async ({ context, page }) => {
      await selectEvent(context, fixtures.largeEvent);
      await page.goto(`/dashboard/events/${fixtures.largeEvent.slug}/submissions`);
      await page.getByPlaceholder("Search submissions").fill("Lex");
      await page.getByLabel("Status", { exact: true }).selectOption("ACCEPTED");
      await page.getByLabel("Type", { exact: true }).selectOption("ABSTRACT");
      await page.getByLabel("Category", { exact: true }).selectOption(fixtures.largeEvent.designCategoryId);
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page).toHaveURL(/q=Lex/);
      await expect(page).toHaveURL(/status=ACCEPTED/);
      await expect(page).toHaveURL(/type=ABSTRACT/);
      await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
      await expect(page.getByText("Lex Formula")).toBeVisible();

      const query = new URLSearchParams({
        q: "Lex",
        status: "ACCEPTED",
        type: "ABSTRACT",
        category: fixtures.largeEvent.designCategoryId,
      });
      query.append("column", "formTitle");
      query.append("column", "applicant");
      query.append("column", "answer:audience");

      query.set("format", "csv");
      const csvResponse = await page.request.get(
        `/dashboard/events/${fixtures.largeEvent.slug}/submissions/export?${query}`,
      );
      expect(csvResponse.ok()).toBe(true);
      const csv = await csvResponse.text();
      expect(csv).toContain("Lex Formula");
      expect(csv).toContain("'=2+2");
      expect(csv).not.toContain("Secret Other Event");
      expect(csv.trim().split("\r\n")).toHaveLength(2);

      query.set("format", "xlsx");
      const xlsxResponse = await page.request.get(
        `/dashboard/events/${fixtures.largeEvent.slug}/submissions/export?${query}`,
      );
      expect(xlsxResponse.ok()).toBe(true);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(await xlsxResponse.body()).buffer);
      const worksheet = workbook.getWorksheet("Submissions");
      expect(worksheet?.getRow(1).values).toEqual([undefined, "Submission", "Applicant", "Audience"]);
      expect(worksheet?.getRow(2).values).toEqual([undefined, "Board Game Design CFP", "Lex Formula", "'=2+2"]);
      expect(worksheet?.rowCount).toBe(2);
    });
  });
