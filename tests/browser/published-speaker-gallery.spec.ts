import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { createFileStorage } from "../../src/server/infrastructure/file-storage.ts";
import type { PublishedProgramSnapshot } from "../../src/server/published-program/repositories.ts";
import { randomUUID } from "node:crypto";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: databaseUrl });
const eventSlug = `published-speaker-gallery-${randomUUID()}`;
const eventId = randomUUID();
const programId = randomUUID();
const speakerIds = { alex: randomUUID(), jordan: randomUUID(), morgan: randomUUID() };
const sessionIds = { opening: randomUUID(), workshop: randomUUID() };
const photoObjectKey = `events/${eventId}/speakers/${speakerIds.alex}/${randomUUID()}`;
const fileStorage = createFileStorage({
  driver: "local",
  rootDirectory: process.env.FILE_STORAGE_PATH ?? "./.data/files",
});

function snapshot(revision = 1): PublishedProgramSnapshot {
  return {
    schemaVersion: 1,
    event: {
      id: eventId,
      name: "Open Table Summit",
      slug: eventSlug,
      websiteUrl: "https://example.test/open-table",
      location: "Oakland, CA",
      timezone: "America/Los_Angeles",
      startsAt: "2027-06-10T16:00:00.000Z",
      endsAt: "2027-06-12T00:00:00.000Z",
      theme: null,
    },
    rooms: [],
    tracks: [],
    speakers: [
      {
        id: speakerIds.alex,
        givenName: "Alexandria",
        familyName: "Rivera-Washington-Smythe",
        preferredName: "Alex",
        pronouns: "they/them",
        organization: "Tabletop Guild",
        jobTitle: "Community Director",
        biography:
          revision === 1
            ? "Alex builds inclusive tabletop communities. This intentionally long biography confirms that detailed public profiles wrap cleanly inside a responsive gallery card without escaping the host embed."
            : "Alex now leads the republished community program.",
        websiteUrl: "https://example.test/alex",
        photoObjectKey,
      },
      {
        id: speakerIds.jordan,
        givenName: "Jordan",
        familyName: "Lee",
        preferredName: "Jordy",
        pronouns: null,
        organization: "Design Commons",
        jobTitle: null,
        biography: null,
        websiteUrl: null,
        photoObjectKey: null,
      },
      {
        id: speakerIds.morgan,
        givenName: "Morgan",
        familyName: "Chen",
        preferredName: null,
        pronouns: "she/her",
        organization: "Tabletop Guild",
        jobTitle: "Game Designer",
        biography: "Morgan designs collaborative games for players of every experience level.",
        websiteUrl: null,
        photoObjectKey: null,
      },
    ],
    sessions: [
      {
        id: sessionIds.opening,
        title: revision === 1 ? "Welcoming Every Player" : "Designing Welcoming Tables",
        description: null,
        durationMinutes: 45,
        trackId: null,
        speakerIds: [speakerIds.alex],
      },
      {
        id: sessionIds.workshop,
        title: "Collaborative Worldbuilding",
        description: null,
        durationMinutes: 60,
        trackId: null,
        speakerIds: [speakerIds.alex, speakerIds.jordan],
      },
    ],
    placements: [],
  };
}

async function publish(versionNumber: number, state: "PUBLISHED" | "UNPUBLISHED", data?: PublishedProgramSnapshot) {
  await database.query(
    `INSERT INTO "published_program_versions"
       ("id", "eventId", "publishedProgramId", "versionNumber", "state", "actorPrincipalId", "snapshot")
     VALUES ($1, $2, $3, $4, $5, 'browser-fixture', $6::jsonb)`,
    [randomUUID(), eventId, programId, versionNumber, state, data ? JSON.stringify(data) : null],
  );
}

test.beforeAll(async () => {
  const photo = await fileStorage.put({
    key: photoObjectKey,
    contentType: "image/svg+xml",
    bytes: new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#777"/><circle cx="48" cy="38" r="18" fill="#fff"/><path d="M18 92c3-24 18-36 30-36s27 12 30 36" fill="#fff"/></svg>',
    ),
    metadata: {},
  });
  if (!photo.ok) throw new Error(`Unable to create speaker photo fixture: ${photo.error.code}`);

  await database.query(
    `INSERT INTO "events" ("id", "name", "slug", "timezone", "startsAt", "endsAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
    [
      eventId,
      "Open Table Summit",
      eventSlug,
      "America/Los_Angeles",
      "2027-06-10T16:00:00.000Z",
      "2027-06-12T00:00:00.000Z",
    ],
  );
  await database.query(`INSERT INTO "published_programs" ("id", "eventId") VALUES ($1, $2)`, [programId, eventId]);
  await publish(1, "PUBLISHED", snapshot());
});

test.afterAll(async () => {
  await database.query(`DELETE FROM "events" WHERE "id" = $1`, [eventId]);
  await fileStorage.delete(photoObjectKey);
  await database.end();
});

test("renders, filters, resizes, republishes, and unpublishes an isolated accessible speaker gallery", async ({
  page,
}) => {
  const embedPath = `/embed/${eventSlug}?kind=speaker-gallery&theme=dark&density=compact&filter=search&filter=organization`;
  const photoResponse = await page.request.get(`${baseURL}/embed/${eventSlug}/speakers/${speakerIds.alex}/photo?v=1`);
  expect(photoResponse.status()).toBe(200);
  expect(photoResponse.headers()["content-type"]).toBe("image/svg+xml");
  expect(photoResponse.headers()["content-security-policy"]).toContain("sandbox");
  expect(photoResponse.headers()["x-content-type-options"]).toBe("nosniff");
  await page.route(`${baseURL}/speaker-gallery-host`, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `
        <!doctype html>
        <html lang="en">
          <head>
            <title>Representative speaker gallery host</title>
            <style>
              body { margin: 0; background: rgb(255, 0, 0); }
              h1, h2, p, li { color: rgb(255, 0, 0) !important; font-size: 60px !important; }
              iframe { display: block; width: 100%; height: 1200px; border: 0; }
            </style>
          </head>
          <body>
            <iframe title="Speaker gallery host fixture" src="${baseURL}${embedPath}"></iframe>
          </body>
        </html>
      `,
    });
  });
  await page.goto(`${baseURL}/speaker-gallery-host`);
  const host = page.getByTitle("Speaker gallery host fixture");
  const gallery = page.frameLocator('iframe[title="Speaker gallery host fixture"]');

  await expect(gallery.getByRole("heading", { name: "Speaker gallery" })).toBeVisible();
  await expect(gallery.getByText("Alex Rivera-Washington-Smythe", { exact: true })).toBeVisible();
  await expect(gallery.getByText("Jordy Lee", { exact: true })).toBeVisible();
  await expect(gallery.getByLabel("Jordy Lee profile image")).toContainText("JL");
  await expect(gallery.locator('img[src*="/photo?v=1"]')).toHaveJSProperty("complete", true);
  expect(
    await gallery.locator('img[src*="/photo?v=1"]').evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  await expect(gallery.getByRole("link", { name: "Welcoming Every Player" })).toHaveAttribute(
    "href",
    new RegExp(`kind=session-list.*#session-${sessionIds.opening}`),
  );
  await expect(gallery.locator("main")).toHaveClass(/dark/);
  expect(
    await gallery
      .getByRole("heading", { name: "Speaker gallery" })
      .evaluate((element) => getComputedStyle(element).color),
  ).not.toBe("rgb(255, 0, 0)");
  await expect(gallery.locator('[data-slot="card"]').first()).toHaveAttribute("data-size", "sm");
  expect(
    await gallery
      .locator("[data-speaker-gallery-grid]")
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length),
  ).toBe(3);

  await gallery.getByLabel("Search speakers").fill("worldbuilding");
  await expect(gallery.getByText("Alex Rivera-Washington-Smythe", { exact: true })).toBeVisible();
  await expect(gallery.getByText("Jordy Lee", { exact: true })).toBeVisible();
  await gallery.getByLabel("Organization").selectOption("Design Commons");
  await expect(gallery.getByText("Alex Rivera-Washington-Smythe", { exact: true })).toBeHidden();
  await expect(gallery.getByText("Jordy Lee", { exact: true })).toBeVisible();
  await gallery.getByLabel("Search speakers").fill("not present");
  await expect(gallery.getByText("No matching speakers")).toBeVisible();

  await gallery.getByLabel("Search speakers").fill("");
  await gallery.getByLabel("Organization").selectOption("");
  await gallery.getByLabel("Search speakers").focus();
  await page.keyboard.press("Tab");
  await expect(gallery.getByLabel("Organization")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(gallery.getByRole("link", { name: "Speaker website" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(gallery.getByRole("link", { name: "Welcoming Every Player" })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await gallery
      .locator("[data-speaker-gallery-grid]")
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length),
  ).toBe(1);
  expect(await gallery.locator("html").evaluate((root) => root.scrollWidth > root.clientWidth)).toBe(false);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await publish(2, "PUBLISHED", snapshot(2));
  await host.evaluate((element: HTMLIFrameElement) => element.contentWindow?.location.reload());
  await expect(gallery.getByText("Alex now leads the republished community program.")).toBeVisible();
  await expect(gallery.getByRole("link", { name: "Designing Welcoming Tables" })).toBeVisible();

  await publish(3, "UNPUBLISHED");
  await host.evaluate((element: HTMLIFrameElement) => element.contentWindow?.location.reload());
  await expect(gallery.getByRole("heading", { name: "Speaker gallery unavailable" })).toBeVisible();
  await expect(gallery.getByText("Alex Rivera-Washington-Smythe", { exact: true })).toBeHidden();
});
