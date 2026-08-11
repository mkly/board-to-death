import { expect, test } from "@playwright/test";

import { magicLinkRequestUrl } from "./fixtures/magic-link-webhook";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  readonly acceptedSpeakerIds: readonly string[];
  readonly sessionToken: string;
}

function reference(submissionId: string): string {
  return `Submission ${submissionId.slice(0, 8).toUpperCase()}`;
}

async function reserveMagicLink(): Promise<{ readonly delivery: Promise<string> }> {
  const requestUrl = magicLinkRequestUrl(randomUUID());
  const registration = await fetch(requestUrl, { method: "POST" });
  if (!registration.ok) throw new Error(`Could not register a speaker invitation (${registration.status}).`);
  return {
    delivery: fetch(requestUrl).then(async (delivery) => {
      if (!delivery.ok) throw new Error(`Could not receive a speaker invitation (${delivery.status}).`);
      return ((await delivery.json()) as { readonly url: string }).url;
    }),
  };
}

test("records and refreshes audited final submission decisions", async ({ context, page }) => {
  test.setTimeout(120_000);
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript], { env: process.env });
  const fixture = JSON.parse(stdout) as BrowserFixture;
  const [waitlistedId, acceptedId, rejectedId] = fixture.submissionIds;
  if (!waitlistedId || !acceptedId || !rejectedId) throw new Error("Expected three decision fixture submissions.");

  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.sessionToken, url: baseURL },
    { name: "gatherpulse_active_event", value: fixture.eventId, url: baseURL },
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

test("invites every accepted speaker and confirms the submission only after all respond", async ({ context, page }) => {
  test.setTimeout(120_000);
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript], { env: process.env });
  const fixture = JSON.parse(stdout) as BrowserFixture;
  const acceptedId = fixture.submissionIds[1];
  if (!acceptedId || fixture.acceptedSpeakerIds.length !== 2) throw new Error("Expected two accepted speakers.");

  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.sessionToken, url: baseURL },
    { name: "gatherpulse_active_event", value: fixture.eventId, url: baseURL },
  ]);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/evaluations/results?round=${fixture.roundId}`);
  let acceptedRow = page.getByRole("row").filter({ hasText: reference(acceptedId) });
  await acceptedRow.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Submission accepted.")).toBeVisible();

  const firstLink = await reserveMagicLink();
  const secondLink = await reserveMagicLink();
  acceptedRow = page.getByRole("row").filter({ hasText: reference(acceptedId) });
  await acceptedRow.getByRole("button", { name: "Invite speakers" }).click();
  await expect(page.getByText("Invitations sent to 2 speakers.")).toBeVisible();

  await page.goto(await firstLink.delivery);
  await expect(page.getByText("Participation confirmed")).toBeVisible();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(1);
  await page.goto(`/portal/${fixture.eventSlug}`);
  await expect(page.getByText("Complete your confirmed speaker profile")).toBeVisible();

  await page.goto(await secondLink.delivery);
  await expect(page.getByText("Participation confirmed")).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(3);
  await page.goto(`/portal/${fixture.eventSlug}`);
  await expect(page.getByText("Complete your confirmed speaker profile")).toBeVisible();
});
