import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: databaseUrl });
let eventSlug = "";
let sessionCookie = "";
const otherEventId = randomUUID();
const otherEventSlug = `other-resources-${randomUUID()}`;

test.beforeAll(async () => {
  const fixture = JSON.parse(
    execFileSync(process.execPath, ["--experimental-strip-types", "tests/browser/fixtures/onboarding.ts"], {
      encoding: "utf8",
      env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl },
    }),
  ) as { eventSlug: string; sessionCookie: string };
  eventSlug = fixture.eventSlug;
  sessionCookie = fixture.sessionCookie;

  await database.query(
    `INSERT INTO "events" ("id", "name", "slug", "timezone", "startsAt", "endsAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
    [
      otherEventId,
      "Other Event",
      otherEventSlug,
      "America/Los_Angeles",
      "2027-06-10T16:00:00.000Z",
      "2027-06-12T00:00:00.000Z",
    ],
  );
  const otherPageId = randomUUID();
  await database.query(
    `INSERT INTO "speaker_resource_pages" ("id", "eventId", "key", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    [otherPageId, otherEventId, "other-event-resource"],
  );
  await database.query(
    `INSERT INTO "speaker_resource_page_versions"
       ("id", "eventId", "pageId", "versionNumber", "slug", "title", "bodyMarkdown", "sortOrder", "publishedAt")
     VALUES ($1, $2, $3, 1, $4, $5, $6, 0, CURRENT_TIMESTAMP)`,
    [randomUUID(), otherEventId, otherPageId, "other-event-resource", "Other event resource", "Not visible here"],
  );
});

test.afterAll(async () => {
  if (eventSlug) await database.query(`DELETE FROM "events" WHERE "slug" = $1`, [eventSlug]);
  await database.query(`DELETE FROM "events" WHERE "id" = $1`, [otherEventId]);
  await database.end();
});

test("administers speaker resource lifecycle, ordering, sanitization, and event isolation", async ({ context, page }) => {
  await context.addCookies([
    { name: "better-auth.session_token", value: sessionCookie, url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);

  await page.goto(`/dashboard/events/${eventSlug}/publishing`);
  await expect(page.getByRole("heading", { name: "Speaker resources" })).toBeVisible();
  await expect(page.getByText("No resources yet")).toBeVisible();

  await page.getByLabel("Title").fill("Travel and lodging");
  await page.getByLabel("URL slug").fill("travel-and-lodging");
  await page.getByLabel("Summary").fill("Everything speakers need for travel.");
  await page
    .getByLabel("Content")
    .fill("## Before you travel\n\nBook your hotel by **September 1**.\n\n<script>window.__xss = true;</script>");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Resource draft created.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Travel and lodging/ }).getByText("draft")).toBeVisible();

  const unpublishedTravel = await page.request.get(`${baseURL}/events/${eventSlug}/resources/travel-and-lodging`);
  expect(unpublishedTravel.status()).toBe(404);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Resource published.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Travel and lodging/ }).getByText("published")).toBeVisible();

  await page.goto(`/events/${eventSlug}/resources`);
  await expect(page.getByText("Travel and lodging")).toBeVisible();

  await page.goto(`/events/${eventSlug}/resources/travel-and-lodging`);
  await expect(page.getByRole("heading", { name: "Travel and lodging" })).toBeVisible();
  await expect(page.locator("strong", { hasText: "September 1" })).toBeVisible();
  expect(await page.content()).not.toContain("window.__xss");
  expect(await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss)).toBeUndefined();

  await page.goto(`/dashboard/events/${eventSlug}/publishing`);
  await page.getByRole("button", { name: /^Travel and lodging/ }).click();
  await page.getByLabel("Content").fill("## Before you travel\n\nBook your hotel by **August 15**.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Resource revision saved.")).toBeVisible();
  await expect(page.getByText("unpublished changes")).toBeVisible();
  await expect(page.getByLabel("Content")).toHaveValue(/August 15/);

  await page.goto(`/events/${eventSlug}/resources/travel-and-lodging`);
  await expect(page.locator("strong", { hasText: "September 1" })).toBeVisible();

  await page.goto(`/dashboard/events/${eventSlug}/publishing`);
  await page.getByRole("button", { name: /^Travel and lodging/ }).click();
  await page.getByRole("button", { name: "Publish update" }).click();
  await expect(page.getByText("Resource published.")).toBeVisible();
  await expect(page.getByText("unpublished changes")).toBeHidden();

  await page.goto(`/events/${eventSlug}/resources/travel-and-lodging`);
  await expect(page.locator("strong", { hasText: "August 15" })).toBeVisible();

  await page.goto(`/dashboard/events/${eventSlug}/publishing`);
  await page.getByRole("button", { name: "New resource" }).click();
  await page.getByLabel("Title").fill("Speaker slides");
  await page.getByLabel("URL slug").fill("speaker-slides");
  await page.getByLabel("Content").fill("Upload slides ahead of time.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Resource draft created.")).toBeVisible();

  const unpublishedSlides = await page.request.get(`${baseURL}/events/${eventSlug}/resources/speaker-slides`);
  expect(unpublishedSlides.status()).toBe(404);

  await page.goto(`/events/${eventSlug}/resources`);
  await expect(page.getByText("Speaker slides")).toBeHidden();

  await page.goto(`/dashboard/events/${eventSlug}/publishing`);
  await page.getByRole("button", { name: /^Speaker slides/ }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Resource published.")).toBeVisible();

  await page.goto(`/events/${eventSlug}/resources`);
  const publishedOrder = await page.locator("main").innerText();
  expect(publishedOrder.indexOf("Travel and lodging")).toBeLessThan(publishedOrder.indexOf("Speaker slides"));

  await page.goto(`/dashboard/events/${eventSlug}/publishing`);
  await page.getByRole("button", { name: "Move Speaker slides up" }).click();
  await expect(page.getByText("Resource order updated.")).toBeVisible();

  await page.goto(`/events/${eventSlug}/resources`);
  const reorderedList = await page.locator("main").innerText();
  expect(reorderedList.indexOf("Speaker slides")).toBeLessThan(reorderedList.indexOf("Travel and lodging"));

  await page.goto(`/dashboard/events/${eventSlug}/publishing`);
  await page.getByRole("button", { name: /^Travel and lodging/ }).click();
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByText("Resource unpublished.")).toBeVisible();

  await page.goto(`/events/${eventSlug}/resources`);
  await expect(page.getByText("Travel and lodging")).toBeHidden();
  await expect(page.getByText("Speaker slides")).toBeVisible();
  const unpublishedAgain = await page.request.get(`${baseURL}/events/${eventSlug}/resources/travel-and-lodging`);
  expect(unpublishedAgain.status()).toBe(404);

  await page.goto(`/dashboard/events/${eventSlug}/publishing`);
  await page.getByRole("button", { name: /^Speaker slides/ }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Archive resource" }).click();
  await expect(page.getByText("Resource archived.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Speaker slides/ })).toBeHidden();

  await page.goto(`/events/${eventSlug}/resources`);
  await expect(page.getByText("No published resources")).toBeVisible();

  await page.goto(`/events/${otherEventSlug}/resources`);
  await expect(page.getByText("Other event resource")).toBeVisible();
  await expect(page.getByText("Travel and lodging")).toBeHidden();
  await expect(page.getByText("Speaker slides")).toBeHidden();

  const crossEventLeak = await page.request.get(`${baseURL}/events/${eventSlug}/resources/other-event-resource`);
  expect(crossEventLeak.status()).toBe(404);
});
