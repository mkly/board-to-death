import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/admin-intake.ts");

interface Fixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly speakerEmail: string;
  readonly sessionCookie: string;
}

async function runFixture<T>(command: "seed" | "cleanup"): Promise<T> {
  const { stdout } = await executeFile(process.execPath, [fixtureScript, command], {
    env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl },
  });
  return JSON.parse(stdout) as T;
}

test.describe
  .serial("admin abstract and session intake", () => {
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

    test("creates a manual abstract and previews mixed CSV rows before idempotent apply", async ({ page }) => {
      await page.goto(`/dashboard/events/${fixture.eventSlug}/sessions/intake`);
      await expect(page.getByRole("heading", { name: "Abstract and session intake" })).toBeVisible();

      await page.getByLabel("Client identifier").fill("manual-browser-abstract");
      await page.getByLabel("Proposal title").fill("Designing safer tables");
      await expect(page.getByLabel("Summary")).toHaveCount(0);
      await page.getByLabel("Format").selectOption("workshop");
      await page.getByLabel("Summary").fill("A practical browser-tested abstract.");
      await page.getByLabel("Format").selectOption("talk");
      await expect(page.getByLabel("Summary")).toHaveCount(0);
      await page.getByLabel("Format").selectOption("workshop");
      await expect(page.getByLabel("Summary")).toHaveValue("A practical browser-tested abstract.");
      await page.getByLabel("Participant to add").click();
      await page.getByRole("option", { name: new RegExp(fixture.speakerEmail) }).click();
      await page.getByRole("button", { name: "Add participant" }).click();
      await page.getByRole("button", { name: "Create record" }).click();
      await expect(page.getByText("Abstract created.")).toBeVisible();

      await page.getByRole("tab", { name: "CSV import" }).click();
      const header = [
        "client_identifier",
        "kind",
        "status",
        "form_key",
        "title",
        "description",
        "duration_minutes",
        "track",
        "participant_emails",
        "category_keys",
        "answers_json",
      ].join(",");
      const csv = [
        header,
        'manual-browser-abstract,abstract,SUBMITTED,main-cfp,,,,,alex@example.test,,"{""title"":""Designing safer tables"",""format"":""workshop"",""summary"":""A practical browser-tested abstract.""}"',
        "partner-session-1,guaranteed_session,,,Opening keynote,Welcome remarks,30,Main stage,alex@example.test,,",
        "broken-row,abstract,SUBMITTED,missing-form,,,,,missing@example.test,,not-json",
      ].join("\r\n");
      await page
        .getByLabel("CSV file")
        .setInputFiles({ name: "admin-intake.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page.getByRole("button", { name: "Preview CSV" }).click();
      await expect(page.getByText("1 create", { exact: true })).toBeVisible();
      await expect(page.getByText("1 unchanged", { exact: true })).toBeVisible();
      await expect(page.getByText("1 rejected", { exact: true })).toBeVisible();
      await expect(page.getByText(/missing-form/)).toBeVisible();

      await page.getByRole("button", { name: "Apply 2 accepted rows" }).click();
      await expect(page.getByText(/Import applied: 1 created, 0 updated, 1 unchanged, 0 rejected/)).toBeVisible();

      await page
        .getByLabel("CSV file")
        .setInputFiles({ name: "admin-intake.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page.getByRole("button", { name: "Preview CSV" }).click();
      await expect(page.getByText("2 unchanged", { exact: true })).toBeVisible();
      await expect(page.getByText("1 rejected", { exact: true })).toBeVisible();
    });
  });
