import { type BrowserContext, expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface SpeakerPortalFixture {
  readonly eventSlug: string;
  readonly populatedAuthHref: string;
  readonly emptyAuthHref: string;
  readonly expiredSessionToken: string;
  readonly ownSubmissionId: string;
  readonly outsiderSubmissionId: string;
}

async function preparePortal(): Promise<SpeakerPortalFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/speaker-portal.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  return JSON.parse(stdout) as SpeakerPortalFixture;
}

async function addSpeakerCookie(context: BrowserContext, value: string): Promise<void> {
  await context.addCookies([{ name: "board-to-death.speaker-session", value, url: `${baseURL}/portal` }]);
}

test("shows the populated speaker portal and keeps another speaker's submission inaccessible", async ({ page }) => {
  const fixture = await preparePortal();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture.populatedAuthHref);

  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}`);
  await expect(page.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("Home");
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("Submissions");
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("Profile");
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("Tasks");
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("Resources");
  await expect(page.getByText("Designing asymmetric systems players can learn")).toBeVisible();
  await expect(page.getByText("Review your public profile")).toBeVisible();
  await expect(page.getByText("Speaker arrival guide")).toBeVisible();

  await page.getByRole("link", { name: "Submissions" }).click();
  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}/submissions`);
  await expect(page.getByRole("heading", { name: "My submissions" })).toBeVisible();
  await page.goto(`/portal/${fixture.eventSlug}/submissions/${fixture.ownSubmissionId}`);
  await expect(page.getByRole("heading", { name: "Board to Death 2027 call for proposals" })).toBeVisible();

  const denied = await page.goto(`/portal/${fixture.eventSlug}/submissions/${fixture.outsiderSubmissionId}`);
  expect(denied?.status()).toBe(404);
});

test("renders an empty dashboard without exposing populated-speaker data", async ({ page }) => {
  const fixture = await preparePortal();
  await page.goto(fixture.emptyAuthHref);

  await expect(page.getByRole("heading", { name: "Welcome, Empty" })).toBeVisible();
  await expect(page.getByText("No submissions yet")).toBeVisible();
  await expect(page.getByText("You are all caught up")).toBeVisible();
  await expect(page.getByText("No sessions scheduled")).toBeVisible();
  await expect(page.getByText("Speaker arrival guide")).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toHaveCount(0);
});

test("redirects an expired speaker session to the event sign-in screen", async ({ context, page }) => {
  const fixture = await preparePortal();
  await addSpeakerCookie(context, fixture.expiredSessionToken);
  await page.goto(`/portal/${fixture.eventSlug}`);

  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}/sign-in?expired=1`);
  await expect(page.getByText("Your speaker session has expired.")).toBeVisible();
});
