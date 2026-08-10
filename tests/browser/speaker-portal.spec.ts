import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { Pool } from "pg";

import { magicLinkRequestUrl } from "./fixtures/magic-link-webhook";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface SpeakerPortalFixture {
  readonly eventSlug: string;
  readonly speakerId: string;
  readonly speakerEmail: string;
  readonly populatedAuthHref: string;
  readonly emptyAuthHref: string;
  readonly emptyResourceAuthHref: string;
  readonly expiredSessionToken: string;
  readonly ownSubmissionId: string;
  readonly outsiderSubmissionId: string;
  readonly textTaskId: string;
  readonly fileTaskId: string;
  readonly formTaskId: string;
  readonly outsiderTaskId: string;
  readonly rehearsalVersionId: string;
  readonly adminSessionCookie: string;
}

const database = new Pool({ connectionString: databaseUrl });

test.afterAll(async () => {
  await database.end();
});

async function preparePortal(): Promise<SpeakerPortalFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/speaker-portal.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  return JSON.parse(stdout) as SpeakerPortalFixture;
}

async function addSpeakerCookie(context: BrowserContext, value: string): Promise<void> {
  const portalUrl = new URL(baseURL);
  await context.addCookies([
    {
      name: "board-to-death.speaker-session",
      value,
      domain: portalUrl.hostname,
      path: "/portal",
      httpOnly: true,
      sameSite: "Lax",
      secure: portalUrl.protocol === "https:",
    },
  ]);
}

// The innermost card that wraps one file input, so "Upload"/"Remove"/"Download"
// and the failure alert resolve within a single control on a page with several.
function fileControl(page: Page, inputId: string): Locator {
  return page
    .locator("div.rounded-lg")
    .filter({ has: page.locator(`#${inputId}`) })
    .last();
}

function payload(signature: readonly number[], trailer = "board-to-death"): Buffer {
  return Buffer.concat([Buffer.from(signature), Buffer.from(trailer, "utf8")]);
}

const PNG_BYTES = payload([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = payload([0xff, 0xd8, 0xff, 0xe0]);
const PDF_BYTES = payload([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const ELF_BYTES = payload([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

// Replacing a file changes no visible control state — the Download link is
// already there — so wait on the Server Action response instead of the DOM
// before reading the stored bytes back.
async function uploadTo(
  page: Page,
  control: Locator,
  inputId: string,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await control.locator(`#${inputId}`).setInputFiles(file);
  const submitted = page.waitForResponse((response) => response.request().method() === "POST");
  await control.getByRole("button", { name: /^(Upload|Replace)$/ }).click();
  await submitted;
}

test("uploads, replaces, downloads, and removes speaker profile files", async ({ page }) => {
  const fixture = await preparePortal();
  await page.goto(fixture.populatedAuthHref);
  await page.goto(`/portal/${fixture.eventSlug}/profile`);

  const headshot = fileControl(page, "profile-file-headshot");
  const downloadHref = `/portal/${fixture.eventSlug}/profile/files/headshot`;
  await expect(headshot.getByRole("link", { name: "Download" })).toHaveCount(0);
  expect((await page.request.get(downloadHref)).status()).toBe(404);

  // Executable content wearing an allowed content type is rejected server-side.
  await uploadTo(page, headshot, "profile-file-headshot", {
    name: "headshot.png",
    mimeType: "image/png",
    buffer: ELF_BYTES,
  });
  await expect(headshot.getByText("The file's contents do not match its declared type.")).toBeVisible();
  expect((await page.request.get(downloadHref)).status()).toBe(404);

  await uploadTo(page, headshot, "profile-file-headshot", {
    name: "headshot.png",
    mimeType: "image/png",
    buffer: PNG_BYTES,
  });
  await expect(headshot.getByRole("link", { name: "Download" })).toBeVisible();
  const stored = await page.request.get(downloadHref);
  expect(stored.status()).toBe(200);
  expect(stored.headers()["content-type"]).toBe("image/png");
  expect(stored.headers()["x-content-type-options"]).toBe("nosniff");
  expect(stored.headers()["content-disposition"]).toContain("attachment");
  expect(Buffer.from(await stored.body()).equals(PNG_BYTES)).toBe(true);

  // Replacing swaps the stored bytes rather than adding a second file.
  await uploadTo(page, headshot, "profile-file-headshot", {
    name: "new.jpg",
    mimeType: "image/jpeg",
    buffer: JPEG_BYTES,
  });
  await expect(headshot.getByRole("link", { name: "Download" })).toBeVisible();
  const replaced = await page.request.get(downloadHref);
  expect(replaced.headers()["content-type"]).toBe("image/jpeg");
  expect(Buffer.from(await replaced.body()).equals(JPEG_BYTES)).toBe(true);

  await headshot.getByRole("button", { name: "Remove" }).click();
  await expect(headshot.getByRole("link", { name: "Download" })).toHaveCount(0);
  expect((await page.request.get(downloadHref)).status()).toBe(404);

  // The agreement control enforces its own type list independently.
  const agreement = fileControl(page, "profile-file-agreement");
  await uploadTo(page, agreement, "profile-file-agreement", {
    name: "agreement.pdf",
    mimeType: "application/pdf",
    buffer: ELF_BYTES,
  });
  await expect(agreement.getByText("The file's contents do not match its declared type.")).toBeVisible();
  await uploadTo(page, agreement, "profile-file-agreement", {
    name: "agreement.pdf",
    mimeType: "application/pdf",
    buffer: PDF_BYTES,
  });
  await expect(agreement.getByRole("link", { name: "Download" })).toBeVisible();
  const agreementResponse = await page.request.get(`/portal/${fixture.eventSlug}/profile/files/agreement`);
  expect(agreementResponse.status()).toBe(200);
  expect(agreementResponse.headers()["content-type"]).toBe("application/pdf");
  // Removing one purpose leaves the other purpose's file in place.
  expect((await page.request.get(downloadHref)).status()).toBe(404);
});

test("manages submission slides and supporting documents per speaker", async ({ page }) => {
  const fixture = await preparePortal();
  await page.goto(fixture.populatedAuthHref);
  await page.goto(`/portal/${fixture.eventSlug}/submissions/${fixture.ownSubmissionId}`);

  const slides = fileControl(page, "submission-file-slides");
  const slidesHref = `/portal/${fixture.eventSlug}/submissions/${fixture.ownSubmissionId}/files/slides`;
  expect((await page.request.get(slidesHref)).status()).toBe(404);

  await uploadTo(page, slides, "submission-file-slides", {
    name: "deck.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf at all", "utf8"),
  });
  await expect(slides.getByText("The file's contents do not match its declared type.")).toBeVisible();

  await uploadTo(page, slides, "submission-file-slides", {
    name: "deck.pdf",
    mimeType: "application/pdf",
    buffer: PDF_BYTES,
  });
  await expect(slides.getByRole("link", { name: "Download" })).toBeVisible();
  expect((await page.request.get(slidesHref)).status()).toBe(200);

  const supporting = fileControl(page, "submission-file-supporting-document");
  const supportingHref = `/portal/${fixture.eventSlug}/submissions/${fixture.ownSubmissionId}/files/supportingDocument`;
  await uploadTo(page, supporting, "submission-file-supporting-document", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Session notes for the organizers.", "utf8"),
  });
  await expect(supporting.getByRole("link", { name: "Download" })).toBeVisible();
  expect((await page.request.get(supportingHref)).status()).toBe(200);

  // Removing the slides leaves the supporting document untouched.
  await slides.getByRole("button", { name: "Remove" }).click();
  await expect(slides.getByRole("link", { name: "Download" })).toHaveCount(0);
  expect((await page.request.get(slidesHref)).status()).toBe(404);
  expect((await page.request.get(supportingHref)).status()).toBe(200);

  // Another speaker's submission exposes neither its page nor its files.
  expect(
    (
      await page.request.get(
        `/portal/${fixture.eventSlug}/submissions/${fixture.outsiderSubmissionId}/files/supportingDocument`,
      )
    ).status(),
  ).toBe(404);
});

test("shows the populated speaker portal and keeps another speaker's submission inaccessible", async ({ page }) => {
  const fixture = await preparePortal();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture.populatedAuthHref);

  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}`);
  await expect(page.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("Home");
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("My submissions");
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("My profile");
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("Onboarding tasks");
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toContainText("Resources");
  await expect(page.getByText("Designing asymmetric systems players can learn")).toBeVisible();
  await expect(page.getByText("Review your public profile")).toBeVisible();
  await expect(page.getByText("Speaker arrival guide")).toBeVisible();

  await page.getByRole("link", { name: "My submissions" }).click();
  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}/submissions`);
  await expect(page.getByRole("heading", { name: "My submissions" })).toBeVisible();
  await page.goto(`/portal/${fixture.eventSlug}/submissions/${fixture.ownSubmissionId}`);
  await expect(page.getByRole("heading", { name: "Board to Death 2027 call for proposals" })).toBeVisible();
  await expect(page.getByLabel("Room setup notes")).toHaveValue("Six tables in a circle");
  await page.getByLabel("Room setup notes").fill("Eight tables with accessible aisles");
  await page.getByRole("button", { name: "Save additional information" }).click();
  await expect(page.getByText("Additional information updated.")).toBeVisible();
  const savedCustomField = await database.query<{ value: string }>(
    `SELECT v."value" #>> '{}' AS "value"
     FROM "custom_field_values" v
     JOIN "custom_field_definitions" d ON d."id" = v."definitionId"
     WHERE v."submissionId" = $1 AND d."key" = 'room_setup'`,
    [fixture.ownSubmissionId],
  );
  expect(savedCustomField.rows).toEqual([{ value: "Eight tables with accessible aisles" }]);

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

test("creates an audience portal, previews its match, and enforces participant visibility", async ({
  context,
  page,
}) => {
  const fixture = await preparePortal();
  const eventResult = await database.query<{ id: string }>(`SELECT id FROM events WHERE slug = $1`, [
    fixture.eventSlug,
  ]);
  const eventId = eventResult.rows[0]?.id;
  if (!eventId) throw new Error("Expected the portal fixture event.");

  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.adminSessionCookie, url: baseURL },
    { name: "board_to_death_active_event", value: eventId, url: baseURL },
  ]);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/portals`);
  await expect(page.getByRole("heading", { name: "Participant portals" })).toBeVisible();

  await page.getByLabel("Name").fill("VIP speakers");
  await page.getByLabel("Slug").fill("vip-speakers");
  await page.getByLabel("Welcome message").fill("Welcome to your private speaker workspace.");
  await page.getByRole("tab", { name: "Audience" }).click();
  await page.getByRole("checkbox", { name: "speaker" }).check();
  await page.getByRole("tab", { name: "Content" }).click();
  await page.getByRole("checkbox", { name: "Resources" }).uncheck();
  await page.getByRole("tab", { name: "Fields" }).click();
  await page.getByLabel("Organization").click();
  await page.getByRole("option", { name: "View only" }).click();
  await page.getByLabel("Accessibility needs").click();
  await page.getByRole("option", { name: "Hidden" }).click();
  await page.getByRole("button", { name: "Save portal" }).click();
  await expect(page.getByText("Portal created.")).toBeVisible();

  await page.getByRole("tab", { name: "Preview" }).click();
  await page.getByLabel("Preview participant").click();
  await page.getByRole("option", { name: /Ada Lovelace/ }).click();
  await expect(page.getByLabel("Preview", { exact: true }).getByText("VIP speakers", { exact: true })).toBeVisible();

  await page.goto(fixture.populatedAuthHref);
  await expect(page.getByText("Welcome to your private speaker workspace.")).toBeVisible();
  await expect(page.getByText("VIP speakers", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).not.toContainText("Resources");
  const hiddenResource = await page.goto(`/portal/${fixture.eventSlug}/resources`);
  expect(hiddenResource?.status()).toBe(404);

  await page.goto(`/portal/${fixture.eventSlug}/profile`);
  await expect(page.getByLabel("Organization")).toBeDisabled();
  await expect(page.getByLabel("Accessibility needs")).toBeHidden();
});

test("navigates ordered published resources and reflects publication changes", async ({ page }) => {
  const fixture = await preparePortal();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture.populatedAuthHref);

  const resourcesNavigation = page.getByRole("navigation", { name: "Speaker portal" }).getByRole("link", {
    name: "Resources",
  });
  await resourcesNavigation.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}/resources`);
  await expect(page.getByRole("heading", { name: "Speaker resources" })).toBeVisible();
  await expect(page.locator('[data-slot="card-title"]')).toHaveText([
    "1. Technical rehearsal",
    "2. Speaker arrival guide",
  ]);
  await expect(page.getByText("Draft resource")).toHaveCount(0);

  const firstResource = page.getByRole("listitem").filter({ hasText: "Technical rehearsal" });
  await firstResource.getByRole("link", { name: "Open" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}/resources/technical-rehearsal`);
  await expect(page.getByRole("heading", { name: "Before you arrive", level: 1 })).toBeVisible();
  await expect(page.getByTitle("Allowed recording")).toBeVisible();
  await expect(page.getByTitle("Not configured")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "venue map" })).toHaveAttribute("href", "https://example.test/venue");

  await page.getByRole("link", { name: "Speaker arrival guide" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}/resources/arrival-guide`);
  await expect(page.getByTitle("Unconfigured allowlist")).toBeVisible();

  for (const hiddenSlug of ["draft-resource", "unpublished-resource", "archived-resource", "other-event-only"]) {
    const response = await page.goto(`/portal/${fixture.eventSlug}/resources/${hiddenSlug}`);
    expect(response?.status()).toBe(404);
  }

  await page.goto(`/portal/${fixture.eventSlug}/resources/technical-rehearsal`);
  await database.query(
    `UPDATE speaker_resource_page_versions SET "unpublishedAt" = '2027-03-01T18:00:00.000Z' WHERE id = $1`,
    [fixture.rehearsalVersionId],
  );
  const unpublished = await page.reload();
  expect(unpublished?.status()).toBe(404);

  await database.query(`UPDATE speaker_resource_page_versions SET "unpublishedAt" = NULL WHERE id = $1`, [
    fixture.rehearsalVersionId,
  ]);
  await page.goto(`/portal/${fixture.eventSlug}/resources/technical-rehearsal`);
  await expect(page.getByRole("heading", { name: "Before you arrive", level: 1 })).toBeVisible();
});

test("shows a useful resource empty state for an event without publications", async ({ page }) => {
  const fixture = await preparePortal();
  await page.goto(fixture.emptyResourceAuthHref);
  await page.getByRole("navigation", { name: "Speaker portal" }).getByRole("link", { name: "Resources" }).click();

  await expect(page.getByRole("heading", { name: "Speaker resources" })).toBeVisible();
  await expect(page.getByText("No resources published")).toBeVisible();
  await expect(page.getByText("Event guidance and speaker materials will appear here.")).toBeVisible();
});

test("validates, saves, and reloads only speaker-editable profile fields", async ({ page }) => {
  const fixture = await preparePortal();
  await page.goto(fixture.populatedAuthHref);
  await expect(page.getByRole("link", { name: "My profile" })).toHaveAttribute(
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

test("requests a fresh link after session expiry and lets an organizer resend it", async ({ context, page }) => {
  const fixture = await preparePortal();
  await addSpeakerCookie(context, fixture.expiredSessionToken);
  await page.goto(`/portal/${fixture.eventSlug}`);

  const speakerRequestUrl = magicLinkRequestUrl(randomUUID());
  expect((await fetch(speakerRequestUrl, { method: "POST" })).ok).toBe(true);
  const speakerDelivery = fetch(speakerRequestUrl);
  speakerDelivery.catch(() => undefined);

  await page.getByLabel("Email address").fill(fixture.speakerEmail);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByText("If that address belongs to a speaker for this event, a sign-in link is on its way."),
  ).toBeVisible();
  const deliveredSpeakerLink = await speakerDelivery;
  expect(deliveredSpeakerLink.ok).toBe(true);
  await page.goto(((await deliveredSpeakerLink.json()) as { url: string }).url);
  await expect(page).toHaveURL(`/portal/${fixture.eventSlug}`);
  await expect(page.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible();

  await page.goto(`/portal/${fixture.eventSlug}/sign-in`);
  await page.getByLabel("Email address").fill("unknown@example.test");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByText("If that address belongs to a speaker for this event, a sign-in link is on its way."),
  ).toBeVisible();

  const organizerRequestUrl = magicLinkRequestUrl(randomUUID());
  expect((await fetch(organizerRequestUrl, { method: "POST" })).ok).toBe(true);
  const organizerDelivery = fetch(organizerRequestUrl);
  organizerDelivery.catch(() => undefined);
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.adminSessionCookie, url: baseURL }]);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/speakers/${fixture.speakerId}`);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText("A fresh speaker portal sign-in link was sent.")).toBeVisible();
  expect((await organizerDelivery).ok).toBe(true);
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

test("shows conditional task fields, restores their values, and omits hidden answers", async ({ page }) => {
  const fixture = await preparePortal();
  await page.goto(fixture.populatedAuthHref);
  await page.goto(`/portal/${fixture.eventSlug}/tasks/${fixture.formTaskId}`);

  await expect(page.getByRole("heading", { name: "Request travel assistance" })).toBeVisible();
  await expect(page.getByLabel("Travel details")).toHaveCount(0);
  await page.getByLabel("I need travel help").check();
  await page.getByLabel("Travel details").fill("Please arrange an accessible airport transfer.");
  await page.getByLabel("I need travel help").uncheck();
  await expect(page.getByLabel("Travel details")).toHaveCount(0);
  await page.getByLabel("I need travel help").check();
  await expect(page.getByLabel("Travel details")).toHaveValue("Please arrange an accessible airport transfer.");
  await page.getByLabel("I need travel help").uncheck();
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByText("Awaiting event-team review")).toBeVisible();

  const submissions = await database.query<{ response: Record<string, unknown> }>(
    `SELECT response FROM speaker_task_submissions WHERE "assignmentId" = $1 ORDER BY "attemptNumber" DESC LIMIT 1`,
    [fixture.formTaskId],
  );
  expect(submissions.rows[0]?.response).toEqual({ "needs-help": false });
});
