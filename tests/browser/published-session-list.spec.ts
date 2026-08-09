import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import type { PublishedProgramSnapshot } from "../../src/server/published-program/repositories.ts";
import { randomUUID } from "node:crypto";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: databaseUrl });
const eventSlug = `published-sessions-${randomUUID()}`;
const eventId = randomUUID();
const programId = randomUUID();
const trackIds = { design: randomUUID(), community: randomUUID() };
const speakerIds = { morgan: randomUUID(), riley: randomUUID() };
const sessionIds = { workshop: randomUUID(), roundtable: randomUUID(), clinic: randomUUID() };

function snapshot(eventIdentifier: string, revision = 1): PublishedProgramSnapshot {
  return {
    schemaVersion: 1,
    event: {
      id: eventIdentifier,
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
    tracks: [
      { id: trackIds.design, name: "Game design", color: "neutral", sortOrder: 1 },
      { id: trackIds.community, name: "Community", color: "neutral", sortOrder: 2 },
    ],
    speakers: [
      {
        id: speakerIds.morgan,
        givenName: "Morgan",
        familyName: "Rivera",
        preferredName: null,
        pronouns: null,
        organization: "Tabletop Guild",
        jobTitle: "Designer",
        biography: "This public profile is safe to publish.",
        websiteUrl: null,
        photoObjectKey: null,
      },
      {
        id: speakerIds.riley,
        givenName: "Riley",
        familyName: "Chen",
        preferredName: "Rye",
        pronouns: null,
        organization: null,
        jobTitle: null,
        biography: null,
        websiteUrl: null,
        photoObjectKey: null,
      },
    ],
    sessions: [
      {
        id: sessionIds.workshop,
        title: revision === 1 ? "Designing welcoming campaign tables" : "Designing kinder campaign tables",
        description:
          "A deliberately long public session description that demonstrates how detailed program copy wraps inside a narrow embedded card without leaking into or inheriting styles from the host page.",
        durationMinutes: 90,
        trackId: trackIds.design,
        speakerIds: [speakerIds.morgan],
      },
      {
        id: sessionIds.roundtable,
        title: "Community roundtable",
        description: "A facilitated conversation about sustaining welcoming player communities.",
        durationMinutes: 45,
        trackId: trackIds.community,
        speakerIds: [speakerIds.morgan, speakerIds.riley],
      },
      {
        id: sessionIds.clinic,
        title: "Open design clinic",
        description: null,
        durationMinutes: 30,
        trackId: null,
        speakerIds: [],
      },
    ],
    placements: [],
  };
}

async function addPublishedVersion(
  versionNumber: number,
  publicationSnapshot: PublishedProgramSnapshot,
): Promise<void> {
  await database.query(
    `INSERT INTO "published_program_versions"
       ("id", "eventId", "publishedProgramId", "versionNumber", "state", "actorPrincipalId", "snapshot")
     VALUES ($1, $2, $3, $4, 'PUBLISHED', 'browser-fixture', $5::jsonb)`,
    [randomUUID(), eventId, programId, versionNumber, JSON.stringify(publicationSnapshot)],
  );
}

test.beforeAll(async () => {
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
  await addPublishedVersion(1, snapshot(eventId));
});

test.afterAll(async () => {
  await database.query(`DELETE FROM "events" WHERE "id" = $1`, [eventId]);
  await database.end();
});

test("renders and filters an isolated responsive session list across publication states", async ({ page }) => {
  const embedUrl = `${baseURL}/embed/${eventSlug}?kind=session-list&theme=dark&density=comfortable&filter=search&filter=track&instance=session-list-test`;
  await page.route(`${baseURL}/session-list-host`, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `
        <!doctype html>
        <html lang="en">
          <head>
            <title>Representative embed host</title>
            <style>
              body { margin: 0; padding: 12px; }
              h1, h2, h3, p, li { color: rgb(255, 0, 0) !important; font-size: 60px !important; }
              iframe { display: block; width: 100%; height: 120px; border: 0; }
            </style>
          </head>
          <body>
            <main>
              <h1>Representative host page</h1>
              <iframe
                id="session-list-host"
                src="${embedUrl}"
                title="Published session list"
                sandbox="allow-scripts allow-same-origin"
              ></iframe>
            </main>
            <script>
              const frame = document.getElementById("session-list-host");
              window.addEventListener("message", (event) => {
                if (event.origin !== new URL(frame.src).origin || event.source !== frame.contentWindow) return;
                if (event.data?.type !== "board-to-death:resize" || event.data.instance !== "session-list-test") return;
                frame.style.height = Math.ceil(event.data.height) + "px";
              });
            </script>
          </body>
        </html>
      `,
    });
  });
  await page.goto(`${baseURL}/session-list-host`);

  const host = page.locator("#session-list-host");
  const frame = page.frameLocator("#session-list-host");
  await expect(frame.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(frame.getByRole("heading", { name: "Designing welcoming campaign tables" })).toBeVisible();
  await expect(frame.getByText("Morgan Rivera", { exact: true })).toHaveCount(2);
  await expect(frame.getByText("Rye Chen", { exact: true })).toBeVisible();
  await expect(frame.getByText("Private speaker", { exact: true })).toHaveCount(0);
  await expect(frame.getByRole("link", { name: "Designing welcoming campaign tables" })).toHaveAttribute(
    "href",
    `#session-${sessionIds.workshop}`,
  );
  await expect(frame.locator("main")).toHaveClass(/dark/);
  await expect(host).not.toHaveCSS("height", "120px");
  expect(
    await frame.getByRole("heading", { name: "Sessions" }).evaluate((element) => getComputedStyle(element).color),
  ).not.toBe("rgb(255, 0, 0)");

  await frame.getByLabel("Search sessions").fill("Morgan");
  await expect(frame.getByRole("heading", { name: "Open design clinic" })).toBeHidden();
  await frame.getByLabel("Track").selectOption(trackIds.community);
  await expect(frame.getByRole("heading", { name: "Community roundtable" })).toBeVisible();
  await expect(frame.getByRole("heading", { name: "Designing welcoming campaign tables" })).toBeHidden();
  await frame.getByLabel("Search sessions").fill("missing session");
  await expect(frame.getByText("No matching sessions")).toBeVisible();

  await frame.getByLabel("Search sessions").fill("");
  await frame.getByLabel("Track").selectOption("");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await frame.locator("html").evaluate((element) => element.scrollWidth > window.innerWidth)).toBe(false);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await addPublishedVersion(2, snapshot(eventId, 2));
  await host.evaluate((element: HTMLIFrameElement) => {
    element.contentWindow?.location.reload();
  });
  await expect(frame.getByRole("heading", { name: "Designing kinder campaign tables" })).toBeVisible();

  await addPublishedVersion(3, { ...snapshot(eventId, 2), sessions: [] });
  await host.evaluate((element: HTMLIFrameElement) => {
    element.contentWindow?.location.reload();
  });
  await expect(frame.getByText("No published sessions")).toBeVisible();

  await database.query(
    `INSERT INTO "published_program_versions"
       ("id", "eventId", "publishedProgramId", "versionNumber", "state", "actorPrincipalId")
     VALUES ($1, $2, $3, 4, 'UNPUBLISHED', 'browser-fixture')`,
    [randomUUID(), eventId, programId],
  );
  await host.evaluate((element: HTMLIFrameElement) => {
    element.contentWindow?.location.reload();
  });
  await expect(frame.getByRole("heading", { name: "Sessions unavailable" })).toBeVisible();
});
