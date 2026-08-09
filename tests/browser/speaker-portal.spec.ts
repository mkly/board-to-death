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
  readonly textTaskId: string;
  readonly fileTaskId: string;
  readonly outsiderTaskId: string;
  readonly adminSessionCookie: string;
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

test("validates, saves, and reloads only speaker-editable profile fields", async ({ page }) => {
  const fixture = await preparePortal();
  await page.goto(fixture.populatedAuthHref);
  await expect(page.getByRole("link", { name: "Profile" })).toHaveAttribute(
    "href",
    `/portal/${fixture.eventSlug}/profile`,
  );
  await page.goto(`/portal/${fixture.eventSlug}/profile`);

  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}/profile`);
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeDisabled();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();

  await page.getByLabel("Website or social profile").fill("ftp://example.test/ada");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Enter a valid HTTP or HTTPS URL.")).toBeVisible();

  await page.getByLabel("Phone number").fill("+1 555 0199");
  await page.getByLabel("Pronouns").fill("she/her");
  await page.getByLabel("Organization").fill("Analytical Engines Guild");
  await page.getByLabel("Title").fill("Lead systems designer");
  await page.getByLabel("Biography").fill("Ada builds welcoming strategy games and teaches systems design.");
  await page.getByLabel("Website or social profile").fill("https://social.example.test/ada");
  await page.getByLabel("Accessibility needs").fill("A step-free route to the stage.");
  await page.getByRole("button", { name: "Save profile" }).evaluate((button) => {
    const form = button.closest("form");
    if (!form) throw new Error("Profile form not found.");
    for (const [name, value] of [
      ["email", "forged@example.test"],
      ["givenName", "Forged"],
      ["status", "REJECTED"],
    ]) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
  });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile was updated.")).toBeVisible();
  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}/profile?updated=2`);

  await page.reload();
  await expect(page.getByLabel("Email address")).toHaveValue("ada@example.test");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByLabel("Phone number")).toHaveValue("+1 555 0199");
  await expect(page.getByLabel("Pronouns")).toHaveValue("she/her");
  await expect(page.getByLabel("Organization")).toHaveValue("Analytical Engines Guild");
  await expect(page.getByLabel("Title")).toHaveValue("Lead systems designer");
  await expect(page.getByLabel("Biography")).toHaveValue(
    "Ada builds welcoming strategy games and teaches systems design.",
  );
  await expect(page.getByLabel("Website or social profile")).toHaveValue("https://social.example.test/ada");
  await expect(page.getByLabel("Accessibility needs")).toHaveValue("A step-free route to the stage.");
});

test("redirects an expired speaker session to the event sign-in screen", async ({ context, page }) => {
  const fixture = await preparePortal();
  await addSpeakerCookie(context, fixture.expiredSessionToken);
  await page.goto(`/portal/${fixture.eventSlug}`);

  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}/sign-in?expired=1`);
  await expect(page.getByText("Your speaker session has expired.")).toBeVisible();
});

test("submits text and file tasks, preserves revisions, and enforces speaker ownership", async ({ context, page }) => {
  test.setTimeout(120_000);
  const fixture = await preparePortal();
  await page.goto(fixture.populatedAuthHref);

  await page.goto(`/portal/${fixture.eventSlug}/tasks/${fixture.textTaskId}`);
  await expect(page.getByRole("heading", { name: "Share your arrival details" })).toBeVisible();
  await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
  await page.getByLabel("Your response").fill("I will arrive on Thursday afternoon.");
  await page.getByRole("button", { name: "Submit task" }).click();
  await expect(page.getByText("Awaiting event-team review")).toBeVisible();

  await context.addCookies([{ name: "better-auth.session_token", value: fixture.adminSessionCookie, url: baseURL }]);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/onboarding`);
  const textRow = page.getByRole("row", { name: /Ada Lovelace Share your arrival details/ });
  await expect(textRow).toContainText("I will arrive on Thursday afternoon.");
  await textRow.getByLabel(/Revision feedback/).fill("Please include your flight arrival time.");
  await textRow.getByRole("button", { name: "Request revision" }).click();
  await expect(textRow).toContainText("Revision requested");

  await page.goto(`/portal/${fixture.eventSlug}/tasks/${fixture.textTaskId}`);
  await expect(page.getByText("Please include your flight arrival time.")).toBeVisible();
  await expect(page.getByText("Attempt 1")).toBeVisible();
  await page.getByLabel("Your response").fill("My flight arrives Thursday at 2:30 PM.");
  await page.getByRole("button", { name: "Submit task" }).click();
  await expect(page.getByText("Awaiting event-team review")).toBeVisible();

  await page.goto(`/dashboard/events/${fixture.eventSlug}/onboarding`);
  await page
    .getByRole("row", { name: /Ada Lovelace Share your arrival details/ })
    .getByRole("button", { name: "Approve" })
    .click();
  await expect(page.getByRole("row", { name: /Ada Lovelace Share your arrival details/ })).toContainText("Approved");

  await page.goto(`/portal/${fixture.eventSlug}/tasks/${fixture.fileTaskId}`);
  await page.getByLabel("Response file").setInputFiles({
    name: "slides.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Speaker slides for review"),
  });
  await page.getByRole("button", { name: "Submit task" }).click();
  await expect(page.getByText("Awaiting event-team review")).toBeVisible();
  await expect(page.getByRole("link", { name: "slides.txt" })).toBeVisible();

  const denied = await page.goto(`/portal/${fixture.eventSlug}/tasks/${fixture.outsiderTaskId}`);
  expect(denied?.status()).toBe(404);
});
