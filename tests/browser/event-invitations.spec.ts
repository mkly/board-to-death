import { expect, type Page, test } from "@playwright/test";

import { magicLinkRequestUrl, signInAsAdmin } from "./fixtures/magic-link-webhook";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/event-invitations.ts");

interface BrowserFixture {
  readonly organizationId: string;
  readonly eventSlug: string;
  readonly otherEventSlug: string;
  readonly roundId: string;
  readonly submissionId: string;
}

async function runFixture(action: string, ...args: readonly string[]): Promise<BrowserFixture | null> {
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript, action, ...args], { env: process.env });
  return action === "setup" ? (JSON.parse(stdout) as BrowserFixture) : null;
}

async function captureMagicLink(action: () => Promise<void>): Promise<string> {
  const requestUrl = magicLinkRequestUrl(randomUUID());
  const registration = await fetch(requestUrl, { method: "POST" });
  if (!registration.ok) throw new Error(`Could not register an invitation delivery (${registration.status}).`);
  const deliveryPromise = fetch(requestUrl);
  deliveryPromise.catch(() => undefined);
  try {
    await action();
    const delivery = await deliveryPromise;
    if (!delivery.ok) throw new Error(`Could not receive the invitation (${delivery.status}).`);
    return ((await delivery.json()) as { url: string }).url;
  } catch (error) {
    await fetch(requestUrl, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

async function invite(page: Page, email: string, role: "REVIEWER" | "ORGANIZER_ADMIN"): Promise<string> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Display name").fill(role === "REVIEWER" ? "Riley Reviewer" : "Sam Staff");
  await page.getByLabel("Role").selectOption(role);
  return captureMagicLink(async () => {
    await page.getByRole("button", { name: "Send invitation" }).click();
  });
}

test("invites, accepts, isolates, resends, and revokes event memberships", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const fixture = await runFixture("setup");
  if (!fixture) throw new Error("Expected the event invitation browser fixture.");
  const reviewerEmail = `invited-reviewer-${randomUUID().slice(0, 8)}@example.test`;
  const staffEmail = `invited-staff-${randomUUID().slice(0, 8)}@example.test`;

  try {
    await signInAsAdmin(page);
    // The admin owns every seeded organization, and the dashboard shell only shows events from the
    // active one, so the fixture's organization has to be selected before its event is reachable.
    await page
      .context()
      .addCookies([{ name: "board_to_death_active_org", value: fixture.organizationId, url: baseURL }]);
    await page.goto(`/dashboard/events/${fixture.eventSlug}/settings/team`);
    await expect(page.getByRole("heading", { name: "Team & reviewers" })).toBeVisible();

    const reviewerLink = await invite(page, reviewerEmail, "REVIEWER");
    await expect(page.getByText(`Invitation sent to ${reviewerEmail}.`)).toBeVisible();

    const reviewerContext = await browser.newContext();
    const reviewerPage = await reviewerContext.newPage();
    await reviewerPage.goto(reviewerLink);
    await expect(reviewerPage.getByText("Join Invitation Browser Summit as a reviewer.")).toBeVisible();
    await reviewerPage.getByRole("button", { name: "Accept invitation" }).click();
    await expect(reviewerPage.getByRole("heading", { name: "Your assigned reviews" })).toBeVisible();
    await runFixture("assign", fixture.roundId, fixture.submissionId, reviewerEmail);
    await reviewerPage.reload();
    await expect(reviewerPage.getByRole("link", { name: "Open review" })).toBeVisible();

    const isolationResponse = await reviewerPage.goto(`/dashboard/events/${fixture.otherEventSlug}/settings/team`);
    expect(isolationResponse?.status()).toBe(404);

    await page.reload();
    const memberRow = page.locator("table").first().getByRole("row").filter({ hasText: reviewerEmail });
    await memberRow.getByRole("button", { name: "Set inactive" }).click();
    await expect(page.getByText("Event access set to inactive.")).toBeVisible();
    await reviewerPage.goto("/reviews");
    await expect(reviewerPage.getByText("No active assignments", { exact: true })).toBeVisible();
    await reviewerContext.close();

    await page.goto(`/dashboard/events/${fixture.otherEventSlug}/settings/team`);
    const originalStaffLink = await invite(page, staffEmail, "ORGANIZER_ADMIN");
    const invitationRow = page.locator("table").last().getByRole("row").filter({ hasText: staffEmail });
    const replacementStaffLink = await captureMagicLink(async () => {
      await invitationRow.getByRole("button", { name: "Resend" }).click();
    });
    await expect(page.getByText("Invitation sent again with a fresh link.")).toBeVisible();

    const staleContext = await browser.newContext();
    const stalePage = await staleContext.newPage();
    await stalePage.goto(originalStaffLink);
    await expect(stalePage.getByText("This invitation is no longer available.")).toBeVisible();
    await staleContext.close();

    const refreshedRow = page.locator("table").last().getByRole("row").filter({ hasText: staffEmail });
    await refreshedRow.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText("Pending invitation revoked.")).toBeVisible();
    const revokedContext = await browser.newContext();
    const revokedPage = await revokedContext.newPage();
    await revokedPage.goto(replacementStaffLink);
    await expect(revokedPage.getByText("This invitation is no longer available.")).toBeVisible();
    await revokedContext.close();
  } finally {
    await runFixture("cleanup", fixture.organizationId);
  }
});
