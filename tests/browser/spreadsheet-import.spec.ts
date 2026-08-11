import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/spreadsheet-import.ts");

interface Fixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly sessionCookie: string;
}

async function runFixture<T>(command: "seed" | "cleanup"): Promise<T> {
  const { stdout } = await executeFile(process.execPath, [fixtureScript, command], {
    env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl },
  });
  return JSON.parse(stdout) as T;
}

test.describe
  .serial("spreadsheet imports", () => {
    let fixture: Fixture;

    test.beforeAll(async () => {
      fixture = await runFixture<Fixture>("seed");
    });

    test.beforeEach(async ({ context }) => {
      test.setTimeout(120_000);
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
    });

    test.afterAll(async () => {
      await runFixture("cleanup");
    });

    test("maps, rejects duplicate rows, and atomically commits a corrected contact CSV", async ({ page }) => {
      await page.goto(`/dashboard/events/${fixture.eventSlug}/imports`);
      await expect(page.getByRole("heading", { name: "Spreadsheet imports" })).toBeVisible();
      const duplicateCsv = [
        "Email,Given name,Family name,Meal preference",
        "ada@example.test,Ada,Lovelace,Vegan",
        "ada@example.test,Ada,Byron,Standard",
      ].join("\r\n");
      await page.getByLabel("Spreadsheet").setInputFiles({
        name: "contacts.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(duplicateCsv),
      });
      await page.getByRole("button", { name: "Inspect file" }).click();
      await expect(page.getByText("2 rows found.")).toBeVisible();
      await page.getByRole("button", { name: "Preview changes" }).click();
      await expect(page.getByText("1 rejected", { exact: true })).toBeVisible();
      await expect(page.getByText("Email duplicates row 2.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Commit every row" })).toBeDisabled();

      const validCsv = [
        "Email,Given name,Family name,Meal preference",
        "ada@example.test,Ada,Lovelace,Vegan",
        "grace@example.test,Grace,Hopper,Standard",
      ].join("\r\n");
      await page.getByLabel("Spreadsheet").setInputFiles({
        name: "contacts.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(validCsv),
      });
      await page.getByRole("button", { name: "Inspect file" }).click();
      await page.getByRole("button", { name: "Preview changes" }).click();
      await expect(page.getByText("2 create", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Commit every row" }).click();
      await expect(page.getByText("Import committed: 2 created and 0 updated.")).toBeVisible();
      await expect(page.getByRole("cell", { name: "contacts.csv" })).toBeVisible();
      await expect(page.getByRole("cell", { name: "2 created · 0 updated" })).toBeVisible();
    });
  });
