import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/reviewer-workspace.ts");

interface BrowserFixture {
  readonly eventId: string;
  readonly reviewerToken: string;
  readonly emptyReviewerToken: string;
  readonly identifiedAssignmentId: string;
  readonly blindAssignmentId: string;
  readonly anonymizedAssignmentId: string;
  readonly otherAssignmentId: string;
  readonly blindRoundId: string;
}

async function runFixture(action: string, ...args: readonly string[]): Promise<BrowserFixture | null> {
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript, action, ...args], { env: process.env });
  return action === "setup" ? (JSON.parse(stdout) as BrowserFixture) : null;
}

async function useSession(
  context: { addCookies(cookies: { name: string; value: string; url: string }[]): Promise<void> },
  token: string,
) {
  await context.addCookies([{ name: "better-auth.session_token", value: token, url: baseURL }]);
}

test.describe("reviewer workspace", () => {
  test.setTimeout(120_000);
  test.describe.configure({ mode: "serial" });
  let fixture: BrowserFixture;

  test.beforeAll(async () => {
    const created = await runFixture("setup");
    if (!created) throw new Error("Expected the reviewer browser fixture.");
    fixture = created;
  });

  test.afterAll(async () => {
    await runFixture("cleanup", fixture.eventId);
  });

  test.beforeEach(async ({ context }) => {
    await useSession(context, fixture.reviewerToken);
  });

  test("shows committee work and enforces identified, blind, and anonymized views", async ({ page }) => {
    await page.goto("/reviews");
    await expect(page.getByRole("heading", { name: "Your assigned reviews" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open review" })).toHaveCount(3);

    await page.goto(`/reviews/${fixture.blindAssignmentId}`);
    await expect(page.getByText("Blind review", { exact: true })).toBeVisible();
    await expect(page.getByText("Blind proposal", { exact: true })).toBeVisible();
    await expect(page.getByText("Ada Applicant", { exact: true })).toHaveCount(0);
    await expect(page.locator("main").getByText(/@example\.test/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Speaker name" })).toHaveCount(0);

    await page.goto(`/reviews/${fixture.anonymizedAssignmentId}`);
    await expect(page.getByRole("heading", { name: /^Submission [0-9A-F]{8}$/ })).toBeVisible();
    await expect(page.getByText("Anonymized proposal", { exact: true })).toBeVisible();
    await expect(page.getByText("Ada Applicant", { exact: true })).toHaveCount(0);

    await page.goto(`/reviews/${fixture.identifiedAssignmentId}`);
    await expect(page.getByText("Identified review", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ada Applicant" })).toBeVisible();
    await expect(page.getByText(/ada-.*@example\.test/)).toBeVisible();
  });

  test("returns a masked not-found response for another reviewer's assignment", async ({ page }) => {
    const response = await page.goto(`/reviews/${fixture.otherAssignmentId}`);
    expect(response?.status()).toBe(404);
  });

  test("shows an empty state and removes closed-round or withdrawn work", async ({ context, page }) => {
    await useSession(context, fixture.emptyReviewerToken);
    await page.goto("/reviews");
    await expect(page.getByText("No active assignments", { exact: true })).toBeVisible();

    await useSession(context, fixture.reviewerToken);
    await runFixture("close-round", fixture.blindRoundId);
    await runFixture("revoke-assignment", fixture.anonymizedAssignmentId);
    await page.goto("/reviews");
    await expect(page.getByRole("link", { name: "Open review" })).toHaveCount(1);
  });
});
