import { type BrowserContext, expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers/hydration.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface LifecycleFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly unscheduledSessionId: string;
  readonly sessionCookie: string;
}

async function prepareLifecycle(context: BrowserContext): Promise<LifecycleFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/event-overview.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as LifecycleFixture;
  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL },
    { name: "board_to_death_active_event", value: fixture.eventId, url: baseURL },
  ]);
  return fixture;
}

test.describe("event and session lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test("selectively clones an event and archives and restores it", async ({ context, page }) => {
    test.setTimeout(60_000);
    const fixture = await prepareLifecycle(context);
    await page.goto(`/dashboard/event-settings?event=${fixture.eventId}`);

    const cloneTrigger = page.getByRole("button", { name: "Clone event" });
    await waitForHydration(cloneTrigger);
    await cloneTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Clone Overview Summit" });
    await expect(dialog.getByText(/no contacts, submissions, sessions, assignments/i)).toBeVisible();
    await dialog.getByLabel("Event name").fill("Overview Summit clone");
    await dialog.getByLabel("Slug").fill("overview-summit-clone");
    await dialog.getByRole("button", { name: "Create clone" }).click();

    await expect(page).toHaveURL(/\/dashboard\/event-settings\?event=/);
    await expect(page.getByRole("combobox", { name: "Select event" })).toContainText("Overview Summit clone");
    await page.getByRole("tab", { name: "Rooms & tracks" }).click();
    await expect(page.getByRole("textbox", { name: "Track name", exact: true })).toHaveValue("Game Design");

    await page.getByRole("button", { name: "Archive event" }).click();
    await page.getByRole("button", { name: "Archive event", exact: true }).last().click();
    await expect(page.getByText("Archived event", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore event" })).toBeVisible();

    await page.getByRole("button", { name: "Restore event" }).click();
    await page.getByRole("button", { name: "Restore event", exact: true }).last().click();
    await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
  });

  test("clones a session without carrying over an agenda placement or another event", async ({ context, page }) => {
    test.setTimeout(60_000);
    const fixture = await prepareLifecycle(context);
    await page.goto(`/dashboard/events/${fixture.eventSlug}/sessions?sessionId=${fixture.unscheduledSessionId}`);

    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await page.getByRole("button", { name: "Clone" }).click();
    await expect(page.getByText("Session cloned as an unscheduled manual session.")).toBeVisible();
    await expect(page.getByRole("table").getByText("Unscheduled keynote (copy)", { exact: true })).toBeVisible();
    await expect(page.getByText("Other event secret talk")).toHaveCount(0);
  });
});
