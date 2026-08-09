import { expect, type Locator, type Page, test } from "@playwright/test";
import { Pool } from "pg";

import { signInAsAdmin } from "./fixtures/magic-link-webhook";
import { randomUUID } from "node:crypto";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: testDatabaseUrl });

test.setTimeout(120_000);

async function dragAgendaCard(page: Page, source: Locator, target: Locator, targetY: number): Promise<void> {
  await page.locator("[data-agenda-scroll]").scrollIntoViewIfNeeded();
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  if (!sourceBox || !targetBox) throw new Error("Agenda drag source or target was not visible.");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetY, { steps: 12 });
  await page.mouse.up();
}

test.afterAll(async () => {
  await database.end();
});

test("creates, filters, edits, confirms conflicts, persists, and removes agenda placements", async ({
  context,
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const event = { id: randomUUID(), slug: `browser-agenda-${suffix}` };
  const foreignEvent = { id: randomUUID(), slug: `browser-agenda-foreign-${suffix}` };
  const roomId = randomUUID();
  const secondaryRoomId = randomUUID();
  const trackId = randomUUID();
  const secondaryTrackId = randomUUID();
  const firstSessionId = randomUUID();
  const firstVersionId = randomUUID();
  const secondSessionId = randomUUID();
  const secondVersionId = randomUUID();
  const moderatorId = randomUUID();
  const moderatorProfileId = randomUUID();
  const foreignSpeakerId = randomUUID();
  const foreignProfileId = randomUUID();
  const foreignSessionId = randomUUID();
  const foreignVersionId = randomUUID();
  const now = new Date();
  const seedConnection = await database.connect();
  await seedConnection.query("BEGIN");
  try {
    await seedConnection.query(
      `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, 'Browser agenda event', $2, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5),
              ($6, 'Foreign role event', $7, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5)`,
      [
        event.id,
        event.slug,
        new Date("2027-03-13T17:00:00.000Z"),
        new Date("2027-03-14T00:00:00.000Z"),
        now,
        foreignEvent.id,
        foreignEvent.slug,
      ],
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
      `INSERT INTO "speakers" ("id", "eventId", "normalizedEmail", "updatedAt")
       VALUES ($1, $2, 'moderator@example.test', $3),
              ($4, $5, 'foreign-moderator@example.test', $3)`,
      [moderatorId, event.id, now, foreignSpeakerId, foreignEvent.id],
    );
    await seedConnection.query(
      `INSERT INTO "speaker_profile_versions"
         ("id", "speakerId", "versionNumber", "email", "givenName", "familyName")
       VALUES ($1, $2, 1, 'moderator@example.test', 'Maya', 'Moderator'),
              ($3, $4, 1, 'foreign-moderator@example.test', 'Foreign', 'Moderator')`,
      [moderatorProfileId, moderatorId, foreignProfileId, foreignSpeakerId],
    );
    await seedConnection.query(
      `INSERT INTO "program_sessions" ("id", "eventId", "kind", "updatedAt")
       VALUES ($1, $2, 'MANUAL', $4), ($3, $2, 'MANUAL', $4), ($5, $6, 'MANUAL', $4)`,
      [firstSessionId, event.id, secondSessionId, now, foreignSessionId, foreignEvent.id],
    );
    await seedConnection.query(
      `INSERT INTO "program_session_versions"
         ("id", "eventId", "sessionId", "versionNumber", "title", "durationMinutes", "trackId")
       VALUES ($1, $2, $3, 1, 'Opening keynote', 45, $4),
              ($5, $2, $6, 1, 'Cooperative tension lab', 60, $4),
              ($7, $8, $9, 1, 'Foreign moderator session', 45, NULL)`,
      [
        firstVersionId,
        event.id,
        firstSessionId,
        trackId,
        secondVersionId,
        secondSessionId,
        foreignVersionId,
        foreignEvent.id,
        foreignSessionId,
      ],
    );
    await seedConnection.query(
      `INSERT INTO "program_session_participants"
         ("eventId", "sessionVersionId", "speakerId", "role", "sortOrder")
       VALUES ($1, $2, $3, 'MODERATOR', 0), ($1, $4, $3, 'MODERATOR', 0),
              ($5, $6, $7, 'MODERATOR', 0)`,
      [event.id, firstVersionId, moderatorId, secondVersionId, foreignEvent.id, foreignVersionId, foreignSpeakerId],
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

    await page.goto(`/dashboard/events/${event.slug}/sessions`);
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await page.getByRole("combobox", { name: "Filter sessions by participant role" }).selectOption("MODERATOR");
    await expect(page.getByText("Opening keynote", { exact: true })).toBeVisible();
    await expect(page.getByText("Cooperative tension lab", { exact: true })).toBeVisible();
    await expect(page.getByText("Foreign moderator session", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Inspect Opening keynote" }).click();
    const roleSelect = page.getByRole("combobox", { name: /Maya Moderator/ });
    await roleSelect.click();
    await page.getByRole("option", { name: "Chairperson" }).click();
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByText("Session changes saved.")).toBeVisible();
    await expect
      .poll(async () => {
        const role = await database.query<{ role: string }>(
          `SELECT p."role"
             FROM "program_session_participants" p
             JOIN "program_session_versions" v ON v."id" = p."sessionVersionId"
            WHERE v."sessionId" = $1
            ORDER BY v."versionNumber" DESC
            LIMIT 1`,
          [firstSessionId],
        );
        return role.rows[0]?.role;
      })
      .toBe("CHAIRPERSON");

    await page.goto(`/dashboard/events/${event.slug}/agenda`);
    await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
    const agendaViews = page.locator('[data-slot="card"]').filter({
      has: page.getByText("Agenda views", { exact: true }),
    });
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
    await expect(agendaViews.getByText("Opening keynote")).toBeVisible();
    await expect(agendaViews.getByText("Cooperative tension lab")).toHaveCount(0);

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
    await expect(page.getByRole("alert").filter({ hasText: "Resolve these conflicts" })).toContainText(
      "Speaker Maya Moderator overlaps with Opening keynote",
    );

    await page.getByRole("radio", { name: "Allow after confirmation" }).click();
    await page.getByRole("button", { name: "Add to agenda" }).click();
    const conflictDialog = page.getByRole("alertdialog");
    await expect(conflictDialog).toContainText("Save with 3 agenda conflicts?");
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
    await expect(conflictReview.getByText("1 of 3 conflicts")).toBeVisible();
    await expect(conflictReview.getByText("Speaker: Maya Moderator")).toBeVisible();
    await conflictReview.getByRole("radio", { name: "Room" }).click();
    await expect(conflictReview.getByText("1 of 3 conflicts")).toBeVisible();

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
    await page.setViewportSize({ width: 1920, height: 1080 });

    const workshopLane = page.locator(`[data-agenda-lane="${secondaryRoomId}:${secondaryTrackId}"]`);
    const mainLane = page.locator(`[data-agenda-lane="${roomId}:${trackId}"]`);
    const scheduledCard = page.locator(`[data-agenda-session="${secondSessionId}"]`);
    await dragAgendaCard(
      page,
      scheduledCard.getByRole("button", { name: /Move Cooperative tension lab/ }),
      workshopLane,
      324,
    );
    await expect(page.getByText("Schedule updated")).toBeVisible();
    await expect
      .poll(async () => {
        const placement = await database.query<{
          roomId: string;
          trackId: string | null;
          minute: number;
        }>(
          `SELECT p."roomId", pt."trackId",
                  EXTRACT(MINUTE FROM p."startsAt")::int AS minute
             FROM "agenda_placements" p
             LEFT JOIN "agenda_placement_tracks" pt ON pt."placementId" = p."id"
            WHERE p."sessionId" = $1`,
          [secondSessionId],
        );
        return placement.rows[0];
      })
      .toEqual({ roomId: secondaryRoomId, trackId: secondaryTrackId, minute: 15 });

    const resizeHandle = scheduledCard.getByRole("button", { name: "Resize Cooperative tension lab" });
    await page.locator("[data-agenda-scroll]").scrollIntoViewIfNeeded();
    const resizeBox = await resizeHandle.boundingBox();
    if (!resizeBox) throw new Error("Agenda resize handle was not visible.");
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2 + 18);
    await page.mouse.up();
    await expect
      .poll(async () => {
        const placement = await database.query<{ duration: number }>(
          `SELECT EXTRACT(EPOCH FROM ("endsAt" - "startsAt"))::int / 60 AS duration
             FROM "agenda_placements" WHERE "sessionId" = $1`,
          [secondSessionId],
        );
        return placement.rows[0]?.duration;
      })
      .toBe(75);

    await page.reload();
    await expect(
      page
        .locator(`[data-agenda-lane="${secondaryRoomId}:${secondaryTrackId}"]`)
        .locator(`[data-agenda-session="${secondSessionId}"]`),
    ).toBeVisible();
    const scrollContainer = page.locator("[data-agenda-scroll]");
    await scrollContainer.evaluate((element) => {
      element.scrollTop = 240;
    });
    await expect.poll(() => scrollContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await scrollContainer.evaluate((element) => {
      element.scrollTop = 0;
    });

    const movedCard = page.locator(`[data-agenda-session="${secondSessionId}"]`);
    await dragAgendaCard(page, movedCard.getByRole("button", { name: /Move Cooperative tension lab/ }), mainLane, 108);
    await expect(page.getByText("Schedule change not saved")).toBeVisible();
    await expect(page.getByText(/Resolve the agenda conflicts before saving/)).toBeVisible();
    await expect
      .poll(async () => {
        const placement = await database.query<{ roomId: string }>(
          `SELECT "roomId" FROM "agenda_placements" WHERE "sessionId" = $1`,
          [secondSessionId],
        );
        return placement.rows[0]?.roomId;
      })
      .toBe(secondaryRoomId);

    await page.getByRole("radio", { name: "Confirm conflicts" }).click();
    await dragAgendaCard(page, movedCard.getByRole("button", { name: /Move Cooperative tension lab/ }), mainLane, 108);
    const dragConflictDialog = page.getByRole("alertdialog");
    await expect(dragConflictDialog).toContainText("Save this schedule change with conflicts?");
    await dragConflictDialog.getByRole("button", { name: "Confirm and save" }).click();
    await expect
      .poll(async () => {
        const placement = await database.query<{ roomId: string }>(
          `SELECT "roomId" FROM "agenda_placements" WHERE "sessionId" = $1`,
          [secondSessionId],
        );
        return placement.rows[0]?.roomId;
      })
      .toBe(roomId);

    await page.reload();
    await database.query(`DELETE FROM "agenda_placements" WHERE "sessionId" = $1`, [firstSessionId]);
    await database.query(`UPDATE "agenda_placements" SET "version" = "version" + 1 WHERE "sessionId" = $1`, [
      secondSessionId,
    ]);
    const staleResizeHandle = page.getByRole("button", { name: "Resize Cooperative tension lab" });
    await page.locator("[data-agenda-scroll]").scrollIntoViewIfNeeded();
    const staleResizeBox = await staleResizeHandle.boundingBox();
    if (!staleResizeBox) throw new Error("Agenda resize handle was not visible after reload.");
    await page.mouse.move(staleResizeBox.x + staleResizeBox.width / 2, staleResizeBox.y + staleResizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      staleResizeBox.x + staleResizeBox.width / 2,
      staleResizeBox.y + staleResizeBox.height / 2 + 18,
    );
    await page.mouse.up();
    await expect(page.getByText(/The agenda placement changed; reload it before saving again/)).toBeVisible();
    await expect(page.getByText(/Change reverted/)).toBeVisible();

    await page.reload();
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.getByText("Interactive schedule")).toBeVisible();
    await expect(page.locator("[data-agenda-scroll]")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Scheduled", exact: true }).click();
    await page.getByRole("button", { name: "Edit placement for Cooperative tension lab" }).click();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove placement" }).click();
    await expect
      .poll(async () => {
        const placement = await database.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "agenda_placements" WHERE "sessionId" = $1`,
          [secondSessionId],
        );
        return placement.rows[0]?.count;
      })
      .toBe(0);
    await expect(agendaViews.getByText("No sessions in this view")).toBeVisible();
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" IN ($1, $2)`, [event.id, foreignEvent.id]);
  }
});
