import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { signInAsAdmin } from "./fixtures/magic-link-webhook";
import { randomUUID } from "node:crypto";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: testDatabaseUrl });

test.setTimeout(120_000);

test.afterAll(async () => {
  await database.end();
});

test("creates, filters, edits, confirms conflicts, persists, and removes agenda placements", async ({
  context,
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const event = { id: randomUUID(), slug: `browser-agenda-${suffix}` };
  const roomId = randomUUID();
  const secondaryRoomId = randomUUID();
  const trackId = randomUUID();
  const secondaryTrackId = randomUUID();
  const firstSessionId = randomUUID();
  const firstVersionId = randomUUID();
  const secondSessionId = randomUUID();
  const secondVersionId = randomUUID();
  const now = new Date();
  const seedConnection = await database.connect();
  await seedConnection.query("BEGIN");
  try {
    await seedConnection.query(
      `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, 'Browser agenda event', $2, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5)`,
      [event.id, event.slug, new Date("2027-03-13T17:00:00.000Z"), new Date("2027-03-14T00:00:00.000Z"), now],
    );
    await seedConnection.query(
      `INSERT INTO "rooms" ("id", "eventId", "name", "sortOrder", "updatedAt")
       VALUES ($1, $2, 'Main Hall', 0, $4), ($3, $2, 'Workshop Room', 1, $4)`,
      [roomId, event.id, secondaryRoomId, now],
    );
    await seedConnection.query(
      `INSERT INTO "tracks" ("id", "eventId", "name", "color", "sortOrder", "updatedAt")
       VALUES ($1, $2, 'Game design', 'blue', 0, $4), ($3, $2, 'Publishing', 'orange', 1, $4)`,
      [trackId, event.id, secondaryTrackId, now],
    );
    await seedConnection.query(
      `INSERT INTO "program_sessions" ("id", "eventId", "kind", "updatedAt")
       VALUES ($1, $2, 'MANUAL', $4), ($3, $2, 'MANUAL', $4)`,
      [firstSessionId, event.id, secondSessionId, now],
    );
    await seedConnection.query(
      `INSERT INTO "program_session_versions"
         ("id", "eventId", "sessionId", "versionNumber", "title", "durationMinutes", "trackId")
       VALUES ($1, $2, $3, 1, 'Opening keynote', 45, $4),
              ($5, $2, $6, 1, 'Cooperative tension lab', 60, $4)`,
      [firstVersionId, event.id, firstSessionId, trackId, secondVersionId, secondSessionId],
    );
    await seedConnection.query("COMMIT");
  } catch (error) {
    await seedConnection.query("ROLLBACK");
    throw error;
  } finally {
    seedConnection.release();
  }

  try {
    await signInAsAdmin(page);
    await context.addCookies([
      {
        name: "board_to_death_active_event",
        value: event.id,
        domain: "127.0.0.1",
        path: "/dashboard",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto(`/dashboard/events/${event.slug}/agenda`);
    await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Unscheduled", exact: true }).click();
    await expect(page.getByText("2 sessions")).toBeVisible();

    await page.getByRole("button", { name: "Schedule Opening keynote" }).click();
    await page.getByLabel("Starts at").fill("2027-03-13T10:00");
    await page.getByRole("button", { name: "Add to agenda" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Session added to the agenda.")).toBeVisible();

    await page.reload();
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Scheduled", exact: true }).click();
    await expect(page.getByText("Opening keynote")).toBeVisible();
    await expect(page.getByText("Cooperative tension lab")).toHaveCount(0);

    await page.getByRole("tab", { name: "Day" }).click();
    await expect(page.getByText("Saturday, March 13, 2027")).toBeVisible();
    await expect(page.getByText("10:00 AM–10:45 AM America/Los_Angeles")).toBeVisible();
    await page.getByRole("button", { name: "Next period" }).click();
    await expect(page.getByText("No sessions in this view")).toBeVisible();
    await page.getByRole("button", { name: "Previous period" }).click();

    await page.getByRole("tab", { name: "Week" }).click();
    await expect(page.getByText("Mar 8–Mar 14, 2027")).toBeVisible();
    await page.getByRole("tab", { name: "Month" }).click();
    await expect(page.getByText("March 2027")).toBeVisible();
    await page.getByRole("tab", { name: "Track" }).click();
    await expect(page.getByRole("heading", { name: "Game design" })).toBeVisible();
    await page.getByRole("tab", { name: "Room" }).click();
    await expect(page.getByRole("heading", { name: "Main Hall" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workshop Room" })).toBeVisible();

    await page.getByRole("combobox", { name: "Room" }).click();
    await page.getByRole("option", { name: "Workshop Room" }).click();
    await expect(page.getByText("No sessions in this view")).toBeVisible();
    await page.getByRole("combobox", { name: "Room" }).click();
    await page.getByRole("option", { name: "Main Hall" }).click();
    await page.getByRole("combobox", { name: "Track" }).click();
    await page.getByRole("option", { name: "Game design" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export filtered CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${event.slug}-agenda.csv`);

    const sessionLink = page.getByRole("link", { name: "Opening keynote" });
    await expect(sessionLink).toHaveAttribute("href", new RegExp(`/sessions\\?sessionId=${firstSessionId}$`));

    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Unscheduled", exact: true }).click();
    await page.getByRole("combobox", { name: "Room" }).click();
    await page.getByRole("option", { name: "All rooms" }).click();
    await page.getByRole("combobox", { name: "Track" }).click();
    await page.getByRole("option", { name: "All tracks" }).click();
    await page.getByRole("tab", { name: "List" }).click();
    await page.getByRole("button", { name: "Schedule Cooperative tension lab" }).click();
    await page.getByLabel("Starts at").fill("2027-03-13T10:15");
    await page.getByRole("button", { name: "Add to agenda" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Resolve these conflicts" })).toContainText(
      "Main Hall overlaps with Opening keynote",
    );

    await page.getByRole("radio", { name: "Allow after confirmation" }).click();
    await page.getByRole("button", { name: "Add to agenda" }).click();
    const conflictDialog = page.getByRole("alertdialog");
    await expect(conflictDialog).toContainText("Save with 2 agenda conflicts?");
    await conflictDialog.getByRole("button", { name: "Confirm and save" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Session added to the agenda.")).toBeVisible();

    const concurrentPage = await context.newPage();
    await concurrentPage.goto(`/dashboard/events/${event.slug}/agenda`);
    await concurrentPage.getByRole("combobox", { name: "Status" }).click();
    await concurrentPage.getByRole("option", { name: "Scheduled", exact: true }).click();
    await expect(concurrentPage.getByRole("link", { name: "Opening keynote", exact: true })).toBeVisible();
    await expect(concurrentPage.getByRole("link", { name: "Cooperative tension lab", exact: true })).toBeVisible();
    await concurrentPage.close();

    await page.reload();
    const persistedPlacements = await database.query<{ id: string; sessionId: string }>(
      `SELECT "id", "sessionId" FROM "agenda_placements" WHERE "eventId" = $1`,
      [event.id],
    );
    const firstPlacementId = persistedPlacements.rows.find(({ sessionId }) => sessionId === firstSessionId)?.id;
    const secondPlacementId = persistedPlacements.rows.find(({ sessionId }) => sessionId === secondSessionId)?.id;
    expect(firstPlacementId).toBeTruthy();
    expect(secondPlacementId).toBeTruthy();

    const conflictReview = page.getByRole("region", { name: "Conflict review" });
    await expect(conflictReview.getByRole("heading", { name: "Room", exact: true })).toBeVisible();
    const roomConflict = conflictReview.getByRole("alert").filter({ hasText: "Room: Main Hall" });
    await expect(roomConflict).toContainText("Opening keynote");
    await expect(roomConflict).toContainText("Cooperative tension lab");
    await conflictReview.getByRole("link", { name: "Review Opening keynote" }).first().click();
    await expect(page).toHaveURL(new RegExp(`#conflict-placement-${firstPlacementId}$`));
    await conflictReview.getByRole("link", { name: "Review Cooperative tension lab" }).first().click();
    await expect(page).toHaveURL(new RegExp(`#conflict-placement-${secondPlacementId}$`));
    await conflictReview.getByRole("radio", { name: "Speaker" }).click();
    await expect(conflictReview.getByText("0 of 2 conflicts")).toBeVisible();
    await conflictReview.getByRole("radio", { name: "Room" }).click();
    await expect(conflictReview.getByText("1 of 2 conflicts")).toBeVisible();

    await database.query(`UPDATE "agenda_placements" SET "version" = "version" + 1, "updatedAt" = $1 WHERE "id" = $2`, [
      new Date(),
      secondPlacementId,
    ]);
    const staleEditor = page.locator(`#conflict-placement-${secondPlacementId}`);
    await staleEditor.getByLabel("Start time").fill("2027-03-13T12:00");
    await staleEditor.getByRole("button", { name: "Save placement" }).click();
    await expect(staleEditor.getByText("The agenda placement changed; reload it before saving again.")).toBeVisible();

    await conflictReview.getByRole("button", { name: "Refresh conflicts" }).click();
    const refreshedEditor = page.locator(`#conflict-placement-${secondPlacementId}`);
    await expect(refreshedEditor.getByText("v2")).toBeVisible();
    await refreshedEditor.getByLabel("Start time").fill("2027-03-13T12:00");
    await refreshedEditor.getByRole("button", { name: "Save placement" }).click();
    await expect(conflictReview.getByText("No agenda conflicts")).toBeVisible();

    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Scheduled", exact: true }).click();
    await page.getByRole("button", { name: "Edit placement for Cooperative tension lab" }).click();
    await expect(page.getByLabel("Starts at")).toHaveValue("2027-03-13T12:00");
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove placement" }).click();
    await expect(page.getByText("1 session")).toBeVisible();
    await expect(page.getByText("Cooperative tension lab")).toHaveCount(0);
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" = $1`, [event.id]);
  }
});
