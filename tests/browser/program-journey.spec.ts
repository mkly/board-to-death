import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/program-journey.ts");

interface BrowserFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly sessionToken: string;
}

async function runFixture(action: "setup" | "cleanup", eventId?: string): Promise<BrowserFixture | null> {
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript, action, ...(eventId ? [eventId] : [])], {
    env: process.env,
  });
  return action === "setup" ? (JSON.parse(stdout) as BrowserFixture) : null;
}

test.describe("Program journey", () => {
  test.describe.configure({ mode: "serial" });
  let fixture: BrowserFixture;

  test.beforeAll(async () => {
    const created = await runFixture("setup");
    if (!created) throw new Error("Expected the program journey browser fixture to be created.");
    fixture = created;
  });

  test.afterAll(async () => {
    if (fixture) await runFixture("cleanup", fixture.eventId);
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "better-auth.session_token", value: fixture.sessionToken, url: baseURL },
      { name: "board_to_death_active_event", value: fixture.eventId, url: baseURL },
    ]);
  });

  test("publishes the program, pushes it to Accelevents, and records the sync runs", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventSlug}/agenda`);
    const publication = page.getByRole("region", { name: "Program publication" });
    await expect(publication.getByText("Never published")).toBeVisible();

    await publication.getByRole("button", { name: "Publish program" }).click();
    await expect(publication.getByText("Program version 1 published.")).toBeVisible();
    await expect(publication.getByText("Published v1")).toBeVisible();

    await page.goto(`/dashboard/events/${fixture.eventSlug}/integrations`);
    const push = page.getByRole("region", { name: "Accelevents program push" });
    const pushButton = push.getByRole("button", { name: "Push program" });
    await expect(pushButton).toBeDisabled();
    await push.getByLabel(/push published program v1 now/).check();
    await expect(pushButton).toBeEnabled();
    await pushButton.click();
    await expect(push.getByText("Program push complete: 2 speaker and 2 session actions recorded.")).toBeVisible();

    const status = page.getByRole("region", { name: "Accelevents sync status" });
    await expect(status.getByText("speaker", { exact: true }).first()).toBeVisible();
    await expect(status.getByText("session", { exact: true }).first()).toBeVisible();

    await page.goto(`/dashboard/events/${fixture.eventSlug}/agenda`);
    await expect(publication.getByText("Published v1")).toBeVisible();
    await publication.getByRole("button", { name: "Unpublish" }).click();
    await expect(publication.getByText(/Program version 2 unpublished/)).toBeVisible();
    await expect(publication.getByText("Unpublished", { exact: true })).toBeVisible();

    await page.goto(`/dashboard/events/${fixture.eventSlug}/integrations`);
    await expect(push.getByText("Publish the program from the agenda workspace before pushing")).toBeVisible();
    await expect(pushButton).toBeDisabled();

    await page.goto(`/dashboard/events/${fixture.eventSlug}/agenda`);
    await publication.getByRole("button", { name: "Publish program" }).click();
    await expect(publication.getByText("Program version 3 published.")).toBeVisible();
    await expect(publication.getByText("Published v3")).toBeVisible();
  });
});
