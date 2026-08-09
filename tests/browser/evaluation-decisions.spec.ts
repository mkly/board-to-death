import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/evaluation-decisions.ts");

interface BrowserFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly roundId: string;
  readonly submissionIds: readonly string[];
  readonly sessionToken: string;
}

function reference(submissionId: string): string {
  return `Submission ${submissionId.slice(0, 8).toUpperCase()}`;
}

test("records and refreshes audited final submission decisions", async ({ context, page }) => {
  test.setTimeout(120_000);
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript], { env: process.env });
  const fixture = JSON.parse(stdout) as BrowserFixture;
  const [waitlistedId, acceptedId, rejectedId] = fixture.submissionIds;
  if (!waitlistedId || !acceptedId || !rejectedId) throw new Error("Expected three decision fixture submissions.");

  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.sessionToken, url: baseURL },
    { name: "board_to_death_active_event", value: fixture.eventId, url: baseURL },
  ]);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/evaluations/results?round=${fixture.roundId}`);
  await expect(page.getByRole("heading", { name: "Evaluation results" })).toBeVisible();

  const waitlistedRow = page.getByRole("row").filter({ hasText: reference(waitlistedId) });
  await waitlistedRow.getByRole("button", { name: "Waitlist" }).click();
  await expect(page.getByText("Submission added to the waitlist.")).toBeVisible();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: reference(waitlistedId) })
      .getByText("Waitlisted"),
  ).toBeVisible();

  await page.goto(`/dashboard/events/${fixture.eventSlug}/submissions?status=WAITLISTED`);
  await expect(page.getByRole("row").filter({ hasText: "Waitlisted" })).toContainText("Decision CFP");

  await page.goto(`/dashboard/events/${fixture.eventSlug}/evaluations/results?round=${fixture.roundId}`);
  const convertedRow = page.getByRole("row").filter({ hasText: reference(waitlistedId) });
  await convertedRow.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Submission accepted.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: reference(waitlistedId) })).toContainText("Decision 2");

  const acceptedRow = page.getByRole("row").filter({ hasText: reference(acceptedId) });
  await acceptedRow.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Submission accepted.")).toBeVisible();

  const rejectedRow = page.getByRole("row").filter({ hasText: reference(rejectedId) });
  await rejectedRow.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Submission rejected.")).toBeVisible();

  await page.goto(`/dashboard/events/${fixture.eventSlug}/sessions`);
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByText("waitlist proposal", { exact: true })).toBeVisible();
  await expect(page.getByText("accept proposal", { exact: true })).toBeVisible();
  await expect(page.getByText("Promoted abstract", { exact: true })).toHaveCount(2);

  await page.goto(`/dashboard/events/${fixture.eventSlug}/submissions`);
  const submissionTable = page.getByRole("table");
  await expect(submissionTable.getByText("Accepted", { exact: true })).toHaveCount(2);
  await expect(submissionTable.getByText("Rejected", { exact: true })).toHaveCount(1);
});
