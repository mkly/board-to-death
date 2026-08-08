import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/evaluation-assignments.ts");

interface BrowserFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly sourceReviewerId: string;
  readonly targetReviewerId: string;
  readonly sessionToken: string;
}

async function runFixture(action: "setup" | "deactivate-reviewers", eventId?: string): Promise<BrowserFixture | null> {
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript, action, ...(eventId ? [eventId] : [])], {
    env: process.env,
  });
  return action === "setup" ? (JSON.parse(stdout) as BrowserFixture) : null;
}

test.describe("evaluation reviewer assignments", () => {
  test.describe.configure({ mode: "serial" });
  let fixture: BrowserFixture;

  test.beforeAll(async () => {
    const created = await runFixture("setup");
    if (!created) throw new Error("Expected the evaluation browser fixture to be created.");
    fixture = created;
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "better-auth.session_token", value: fixture.sessionToken, url: baseURL },
      { name: "board_to_death_active_event", value: fixture.eventId, url: baseURL },
    ]);
  });

  test("assigns, reassigns, and withdraws a reviewer through the event workspace", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventSlug}/evaluations/assignments`);
    await expect(page.getByRole("heading", { name: "Reviewer assignments" })).toBeVisible();
    await expect(page.getByLabel("Open round")).toHaveValue(/.+/);
    await expect(page.getByText("2 eligible submissions")).toBeVisible();

    await page
      .getByLabel(/Select submission/)
      .first()
      .click();
    await page.getByLabel("Reviewer", { exact: true }).selectOption(fixture.sourceReviewerId);
    await page.getByRole("button", { name: "Apply action" }).click();
    await expect(page.getByText("1 submission updated.")).toBeVisible();
    await expect(page.getByText("Alex Source", { exact: true })).toBeVisible();

    await page
      .getByLabel(/Select submission/)
      .first()
      .click();
    await page.getByLabel("Action").selectOption("reassign");
    await page.getByLabel("Current reviewer").selectOption(fixture.sourceReviewerId);
    await page.getByLabel("Replacement reviewer").selectOption(fixture.targetReviewerId);
    await page.getByRole("button", { name: "Apply action" }).click();
    await expect(page.getByText("1 submission updated.")).toBeVisible();
    await expect(page.getByText("Bailey Target", { exact: true })).toBeVisible();

    await page
      .getByLabel(/Select submission/)
      .first()
      .click();
    await page.getByLabel("Action").selectOption("withdraw");
    await page.getByLabel("Current reviewer").selectOption(fixture.targetReviewerId);
    await page.getByRole("button", { name: "Apply action" }).click();
    await expect(page.getByText("1 submission updated.")).toBeVisible();
    await expect(page.getByText("Unassigned").first()).toBeVisible();
  });

  test("shows a safe disabled state when the event has no active reviewers", async ({ page }) => {
    await runFixture("deactivate-reviewers", fixture.eventId);
    await page.goto(`/dashboard/events/${fixture.eventSlug}/evaluations/assignments`);
    await expect(page.getByText("No active reviewers")).toBeVisible();
    await page
      .getByLabel(/Select submission/)
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Apply action" })).toBeDisabled();
  });
});
