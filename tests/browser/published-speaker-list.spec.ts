import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import type { PublishedProgramSnapshot } from "../../src/server/published-program/repositories.ts";
import { randomUUID } from "node:crypto";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: databaseUrl });
const eventSlug = `published-speakers-${randomUUID()}`;
const eventId = randomUUID();
const programId = randomUUID();
const speakerIds = { alex: randomUUID(), jordan: randomUUID() };
const sessionIds = { opening: randomUUID(), workshop: randomUUID() };

function snapshot(eventId: string, revision = 1): PublishedProgramSnapshot {
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
        givenName: "Alex",
        familyName: "Rivera",
        preferredName: null,
        pronouns: "they/them",
        organization: "Tabletop Guild",
        jobTitle: "Community Director",
        biography:
          revision === 1
            ? "Alex builds inclusive tabletop communities. This intentionally long biography checks that detailed public profiles wrap cleanly without escaping their embed container on narrow screens."
            : "Alex now leads the republished community program.",
        websiteUrl: "https://example.test/alex",
        photoObjectKey: null,
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
  await database.query(
    `INSERT INTO "published_program_versions"
       ("id", "eventId", "publishedProgramId", "versionNumber", "state", "actorPrincipalId", "snapshot")
     VALUES ($1, $2, $3, 1, 'PUBLISHED', 'browser-fixture', $4::jsonb)`,
    [randomUUID(), eventId, programId, JSON.stringify(snapshot(eventId))],
  );
});

test.afterAll(async () => {
  await database.query(`DELETE FROM "events" WHERE "id" = $1`, [eventId]);
  await database.end();
});

test("filters a responsive speaker list and reflects republished and unpublished states", async ({ page }) => {
  const embedUrl = `/embed/${eventSlug}?kind=speaker-list&theme=system&density=comfortable&filter=search&filter=organization`;
  await page.goto(embedUrl);

  await expect(page.getByRole("heading", { name: "Speakers" })).toBeVisible();
  await expect(page.getByText("Alex Rivera", { exact: true })).toBeVisible();
  await expect(page.getByText("Jordy Lee", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Alex Rivera profile image")).toContainText("AR");
  await expect(page.getByRole("link", { name: "Welcoming Every Player" })).toHaveAttribute(
    "href",
    new RegExp(`kind=session-list.*#session-${sessionIds.opening}`),
  );

  await page.getByLabel("Search speakers").fill("worldbuilding");
  await expect(page.getByText("Alex Rivera", { exact: true })).toBeVisible();
  await expect(page.getByText("Jordy Lee", { exact: true })).toBeVisible();
  await page.getByLabel("Organization").selectOption("Design Commons");
  await expect(page.getByText("Alex Rivera", { exact: true })).toBeHidden();
  await expect(page.getByText("Jordy Lee", { exact: true })).toBeVisible();
  await page.getByLabel("Search speakers").fill("not present");
  await expect(page.getByText("No matching speakers")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Search speakers").fill("");
  await page.getByLabel("Organization").selectOption("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await database.query(
    `INSERT INTO "published_program_versions"
       ("id", "eventId", "publishedProgramId", "versionNumber", "state", "actorPrincipalId", "snapshot")
     VALUES ($1, $2, $3, 2, 'PUBLISHED', 'browser-fixture', $4::jsonb)`,
    [randomUUID(), eventId, programId, JSON.stringify(snapshot(eventId, 2))],
  );
  await page.reload();
  await expect(page.getByText("Alex now leads the republished community program.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Designing Welcoming Tables" })).toBeVisible();

  await database.query(
    `INSERT INTO "published_program_versions"
       ("id", "eventId", "publishedProgramId", "versionNumber", "state", "actorPrincipalId")
     VALUES ($1, $2, $3, 3, 'UNPUBLISHED', 'browser-fixture')`,
    [randomUUID(), eventId, programId],
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Speakers unavailable" })).toBeVisible();
  await expect(page.getByText("Alex Rivera", { exact: true })).toBeHidden();
});
