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

const roomId = randomUUID();
const trackIds = { design: randomUUID(), community: randomUUID() };
const speakerId = randomUUID();
const sessionIds = { opening: randomUUID(), lab: randomUUID(), closing: randomUUID() };
const placementIds = { opening: randomUUID(), lab: randomUUID(), closing: randomUUID() };

interface PublishedFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly programId: string;
}

/**
 * Revision 1 is the program an attendee first saves against. Revision 2 moves
 * the keynote and drops the closing circle entirely, which is what exercises
 * reconciliation of a saved selection against a republished program.
 */
function snapshot(fixture: PublishedFixture, revision: 1 | 2): PublishedProgramSnapshot {
  const openingStartsAt = revision === 1 ? "2027-03-13T17:00:00.000Z" : "2027-03-13T17:30:00.000Z";
  const openingEndsAt = revision === 1 ? "2027-03-13T17:45:00.000Z" : "2027-03-13T18:15:00.000Z";

  return {
    schemaVersion: 1,
    event: {
      id: fixture.eventId,
      name: "Published itinerary conference",
      slug: fixture.eventSlug,
      websiteUrl: null,
      location: "Oakland, CA",
      timezone: "America/Los_Angeles",
      startsAt: "2027-03-13T17:00:00.000Z",
      endsAt: "2027-03-14T01:00:00.000Z",
      theme: null,
    },
    rooms: [{ id: roomId, name: "Main Hall", sortOrder: 0 }],
    tracks: [
      { id: trackIds.design, name: "Game design", color: "neutral", sortOrder: 0 },
      { id: trackIds.community, name: "Community", color: "neutral", sortOrder: 1 },
    ],
    speakers: [
      {
        id: speakerId,
        givenName: "Ada",
        familyName: "Lovelace",
        preferredName: null,
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
        id: sessionIds.opening,
        title: revision === 1 ? "Opening keynote" : "Opening keynote rescheduled",
        description: "A long-form look at cooperative play.",
        durationMinutes: 45,
        trackId: trackIds.design,
        speakerIds: [speakerId],
      },
      {
        id: sessionIds.lab,
        title: "Collision lab",
        description: "This intentionally overlaps the keynote.",
        durationMinutes: 45,
        trackId: trackIds.design,
        speakerIds: [],
      },
      ...(revision === 1
        ? [
            {
              id: sessionIds.closing,
              title: "Closing circle",
              description: null,
              durationMinutes: 30,
              trackId: trackIds.community,
              speakerIds: [],
            },
          ]
        : []),
    ],
    placements: [
      {
        id: placementIds.opening,
        sessionId: sessionIds.opening,
        roomId,
        startsAt: openingStartsAt,
        endsAt: openingEndsAt,
        trackIds: [trackIds.design],
        speakerIds: [speakerId],
      },
      {
        id: placementIds.lab,
        sessionId: sessionIds.lab,
        roomId,
        startsAt: "2027-03-13T17:15:00.000Z",
        endsAt: "2027-03-13T18:00:00.000Z",
        trackIds: [trackIds.design],
        speakerIds: [],
      },
      ...(revision === 1
        ? [
            {
              id: placementIds.closing,
              sessionId: sessionIds.closing,
              roomId,
              startsAt: "2027-03-14T00:00:00.000Z",
              endsAt: "2027-03-14T00:30:00.000Z",
              trackIds: [trackIds.community],
              speakerIds: [],
            },
          ]
        : []),
    ],
  };
}

async function publish(fixture: PublishedFixture, revision: 1 | 2): Promise<void> {
  await database.query(
    `INSERT INTO "published_program_versions"
       ("id", "eventId", "publishedProgramId", "versionNumber", "state", "actorPrincipalId", "snapshot")
     VALUES ($1, $2, $3, $4, 'PUBLISHED', 'browser-test', $5::jsonb)`,
    [randomUUID(), fixture.eventId, fixture.programId, revision, JSON.stringify(snapshot(fixture, revision))],
  );
}

async function createFixture(): Promise<PublishedFixture> {
  const fixture: PublishedFixture = {
    eventId: randomUUID(),
    eventSlug: `published-itinerary-${randomUUID().slice(0, 8)}`,
    programId: randomUUID(),
  };
  await database.query(
    `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
     VALUES ($1, 'Published itinerary conference', $2, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5)`,
    [
      fixture.eventId,
      fixture.eventSlug,
      new Date("2027-03-13T17:00:00.000Z"),
      new Date("2027-03-14T01:00:00.000Z"),
      new Date(),
    ],
  );
  await database.query(`INSERT INTO "published_programs" ("id", "eventId") VALUES ($1, $2)`, [
    fixture.programId,
    fixture.eventId,
  ]);
  await publish(fixture, 1);
  return fixture;
}

test.afterAll(async () => {
  await database.end();
});

test("builds, persists, and reconciles a browser-local published itinerary", async ({ page }) => {
  const fixture = await createFixture();
  const embedPath = `/embed/${fixture.eventSlug}?kind=itinerary&theme=dark&density=comfortable&filter=search&filter=track&filter=day&instance=browser-test`;
  const itinerary = page.getByRole("region", { name: "My itinerary" });
  const published = page.getByRole("list", { name: "Published sessions" });

  try {
    await page.goto(embedPath);
    await expect(page.getByRole("heading", { level: 1, name: "Itinerary" })).toBeVisible();
    await expect(page.getByText("Published itinerary conference")).toBeVisible();
    await expect(itinerary).toContainText("Your itinerary is empty");

    // Keyboard access: the session checkbox is reachable and togglable without a pointer.
    await page.getByLabel("Add Opening keynote to itinerary").focus();
    await page.keyboard.press("Space");
    await expect(itinerary).toContainText("Opening keynote");
    await expect(itinerary).toContainText("1 session");

    // A collision is surfaced, not silently swallowed and not refused.
    await page.getByLabel("Add Collision lab to itinerary").click();
    await expect(itinerary).toContainText("2 sessions");
    await expect(itinerary.getByText("Time conflict")).toBeVisible();
    await expect(itinerary.getByText("Overlaps")).toHaveCount(2);

    await page.getByLabel("Add Closing circle to itinerary").click();
    await expect(itinerary).toContainText("3 sessions");

    // Times carry an explicit zone abbreviation for the event time zone, not the browser's.
    await expect(itinerary).toContainText("PST");

    // Removing from the itinerary side clears the corresponding checkbox.
    await itinerary.getByRole("button", { name: "Remove Collision lab from itinerary" }).click();
    await expect(itinerary).toContainText("2 sessions");
    await expect(page.getByLabel("Add Collision lab to itinerary")).toBeVisible();

    await page.reload();
    await expect(itinerary).toContainText("2 sessions");
    await expect(itinerary).toContainText("Opening keynote");
    await expect(itinerary).toContainText("Closing circle");

    await publish(fixture, 2);
    await page.reload();
    await expect(itinerary).toContainText("Opening keynote rescheduled");
    await expect(itinerary).toContainText("1 saved session is no longer in the published program");
    await expect(itinerary).not.toContainText("Closing circle");
    await expect(itinerary).toContainText("1 session");
    await expect(itinerary).toContainText("9:30 AM");

    await page.getByLabel("Search sessions").fill("collision");
    await expect(published).toContainText("Collision lab");
    await expect(published).not.toContainText("Opening keynote rescheduled");
    await page.getByLabel("Search sessions").fill("no such session anywhere");
    await expect(page.getByText("No matching sessions")).toBeVisible();
    await page.getByLabel("Search sessions").fill("");

    await page.getByLabel("Track").selectOption({ label: "Game design" });
    await expect(published).toContainText("Collision lab");

    // Mobile layout: no horizontal overflow, and no accessibility violations.
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" = $1`, [fixture.eventId]);
  }
});

test("renders inside a hostile host page without inheriting its styles", async ({ page }) => {
  const fixture = await createFixture();
  const embedPath = `/embed/${fixture.eventSlug}?kind=itinerary&theme=light&density=compact&filter=search&instance=browser-test`;

  try {
    await page.goto(baseURL);
    await page.setContent(`
      <style>* { color: rgb(255, 0, 255) !important; font-size: 41px !important; }</style>
      <h1>Host page heading</h1>
      <iframe id="hosted-itinerary" title="Hosted itinerary" src="${embedPath}" style="width:100%;height:120px;border:0"></iframe>
      <script>
        const frame = document.getElementById("hosted-itinerary");
        const expectedOrigin = new URL(frame.src, location.href).origin;
        window.addEventListener("message", (event) => {
          if (event.origin !== expectedOrigin || event.source !== frame.contentWindow) return;
          if (event.data?.type !== "board-to-death:resize" || event.data.instance !== "browser-test") return;
          frame.style.height = Math.ceil(event.data.height) + "px";
        });
      </script>
    `);

    const frame = page.getByTitle("Hosted itinerary");
    const heading = frame.contentFrame().getByRole("heading", { level: 1, name: "Itinerary" });
    await expect(heading).toBeVisible();

    // The frame bridge grows the iframe past its placeholder height.
    await expect(async () => {
      expect(await frame.evaluate((element) => element.clientHeight)).toBeGreaterThan(120);
    }).toPass();

    // Host styles do not leak through the frame boundary.
    const styles = await heading.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { color: computed.color, fontSize: computed.fontSize };
    });
    expect(styles.color).not.toBe("rgb(255, 0, 255)");
    expect(styles.fontSize).not.toBe("41px");
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" = $1`, [fixture.eventId]);
  }
});
