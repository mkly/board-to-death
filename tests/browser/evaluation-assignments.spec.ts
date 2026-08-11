import { expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers/hydration.ts";
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
  readonly committeeId: string;
  readonly firstSubmissionId: string;
  readonly secondSubmissionId: string;
  readonly sessionToken: string;
}

type FixtureAction =
  | "setup"
  | "deactivate-reviewers"
  | "remove-committee-member"
  | "start-evaluation"
  | "complete-submission"
  | "open-next-round";

async function runFixture(action: FixtureAction, ...args: readonly string[]): Promise<BrowserFixture | null> {
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript, action, ...args], { env: process.env });
  return action === "setup" ? (JSON.parse(stdout) as BrowserFixture) : null;
}

test.describe("evaluation reviewer assignments", () => {
  test.setTimeout(120_000);
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
      { name: "gatherpulse_active_event", value: fixture.eventId, url: baseURL },
    ]);
  });

  test("assigns, reassigns, and withdraws a reviewer through the event workspace", async ({ page }) => {
    // Every successful apply renders the same "N reviewer assignment(s) updated." alert, so that text
    // cannot tell one step from the next: the assertion after step two passes instantly against step
    // one's alert. Wait on the selection counter instead — the workspace clears the selection only
    // once the action actually resolves, and clicking a checkbox before that clear lands loses it.
    const applyAction = async () => {
      await page.getByRole("button", { name: "Apply action" }).click();
      await expect(page.getByText("0 submissions selected")).toBeVisible();
    };

    await page.goto(`/dashboard/events/${fixture.eventSlug}/evaluations/assignments`);
    await expect(page.getByRole("heading", { name: "Reviewer assignments" })).toBeVisible();
    await expect(page.getByLabel("Open round")).toHaveValue(/.+/);
    await expect(page.getByText("2 eligible submissions")).toBeVisible();
    await waitForHydration(page.getByLabel("Action"));

    await page
      .getByLabel(/Select submission/)
      .first()
      .click();
    await page.getByLabel("Reviewer", { exact: true }).selectOption(fixture.sourceReviewerId);
    await applyAction();
    await expect(page.getByText("1 reviewer assignment updated.")).toBeVisible();
    await expect(page.getByText("Alex Source", { exact: true }).first()).toBeVisible();

    await page
      .getByLabel(/Select submission/)
      .first()
      .click();
    await page.getByLabel("Action").selectOption("reassign");
    await page.getByLabel("Current reviewer").selectOption(fixture.sourceReviewerId);
    await page.getByLabel("Replacement reviewer").selectOption(fixture.targetReviewerId);
    await applyAction();
    await expect(page.getByText("1 reviewer assignment updated.")).toBeVisible();
    await expect(page.getByText("Bailey Target", { exact: true }).first()).toBeVisible();

    await page
      .getByLabel(/Select submission/)
      .first()
      .click();
    await page.getByLabel("Action").selectOption("withdraw");
    await page.getByLabel("Current reviewer").selectOption(fixture.targetReviewerId);
    await applyAction();
    await expect(page.getByText("1 reviewer assignment updated.")).toBeVisible();
    await expect(page.getByText("Unassigned").first()).toBeVisible();

    await page.reload();
    await waitForHydration(page.getByLabel("Action"));
    await page.getByLabel("Action").selectOption("assign-committee");
    await page.getByLabel("Reviewer committee").selectOption(fixture.committeeId);
    const selectAll = page.getByLabel("Select all eligible submissions");
    await waitForHydration(selectAll);
    await selectAll.click();
    await expect(selectAll).toBeChecked();
    await page.getByRole("button", { name: "Apply action" }).click();
    await expect(page.getByText("4 reviewer assignments updated.")).toBeVisible();
    // Scope to the table: an unscoped text match resolves first to the hidden committee <option>.
    await expect(page.getByRole("cell", { name: /Program committee/ }).first()).toBeVisible();
    await expect(page.getByLabel("Assigned: 2")).toBeVisible();

    await runFixture("remove-committee-member", fixture.committeeId, fixture.sourceReviewerId);
    await page.reload();
    await waitForHydration(page.getByLabel("Action"));
    await page.getByLabel("Action").selectOption("assign-committee");
    await expect(page.getByLabel("Reviewer committee").getByText("Program committee · 1 active")).toBeAttached();
    await page.getByLabel(`Select submission ${fixture.secondSubmissionId}`).click();
    await page.getByLabel("Action").selectOption("withdraw");
    await page.getByLabel("Current reviewer").selectOption(fixture.sourceReviewerId);
    await applyAction();
    await expect(page.getByText("1 reviewer assignment updated.")).toBeVisible();
    await page.getByLabel(`Select submission ${fixture.secondSubmissionId}`).click();
    await page.getByLabel("Action").selectOption("assign-committee");
    await page.getByLabel("Reviewer committee").selectOption(fixture.committeeId);
    await applyAction();
    await expect(page.getByText("0 reviewer assignments updated.")).toBeVisible();

    await runFixture("start-evaluation", fixture.firstSubmissionId);
    await page.reload();
    await expect(page.getByLabel("Assigned: 1")).toBeVisible();
    await expect(page.getByLabel("In progress: 1")).toBeVisible();
    await runFixture("complete-submission", fixture.firstSubmissionId);
    await page.reload();
    await expect(page.getByLabel("Assigned: 1")).toBeVisible();
    await expect(page.getByLabel("Complete: 1")).toBeVisible();

    await page.goto(`/dashboard/events/${fixture.eventSlug}/evaluations/results`);
    await expect(page.getByRole("heading", { name: "Evaluation results" })).toBeVisible();
    await expect(page.getByText("2/2 complete", { exact: true })).toBeVisible();
    await expect(page.getByText("4.75", { exact: true })).toBeVisible();
    await expect(page.getByText("1 incomplete", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Advance" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Close round" })).toBeDisabled();
    await page.getByRole("button", { name: "Advance" }).click();
    await expect(page.getByText("Submission advanced to the next evaluation round.")).toBeVisible();
    await expect(page.getByText("Advanced", { exact: true })).toBeVisible();

    await runFixture("complete-submission", fixture.secondSubmissionId);
    await page.reload();
    await expect(page.getByRole("button", { name: "Close round" })).toBeEnabled();
    await page.getByRole("button", { name: "Close round" }).click();
    await expect(page.getByText("Evaluation round closed.")).toBeVisible();

    await runFixture("open-next-round", fixture.eventId);
    await page.goto(`/dashboard/events/${fixture.eventSlug}/evaluations/assignments`);
    await expect(page.getByText("1 eligible submissions", { exact: true })).toBeVisible();
    await expect(page.getByLabel(`Select submission ${fixture.firstSubmissionId}`)).toBeVisible();
    await expect(page.getByLabel(`Select submission ${fixture.secondSubmissionId}`)).toHaveCount(0);
  });

  test("shows a safe disabled state when the event has no active reviewers", async ({ page }) => {
    await runFixture("deactivate-reviewers", fixture.eventId);
    await page.goto(`/dashboard/events/${fixture.eventSlug}/evaluations/assignments`);
    await expect(page.getByText("No active reviewers")).toBeVisible();
    await waitForHydration(page.getByRole("button", { name: "Apply action" }));
    await page
      .getByLabel(/Select submission/)
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Apply action" })).toBeDisabled();
  });
});
