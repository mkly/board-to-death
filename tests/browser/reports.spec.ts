import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { signInAsAdmin } from "./fixtures/magic-link-webhook";
import { waitForHydration } from "./helpers/hydration";
import { randomUUID } from "node:crypto";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: databaseUrl });

test.afterAll(async () => database.end());

test("builds, filters, duplicates, exports, deletes, and isolates saved reports", async ({ context, page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const event = { id: randomUUID(), slug: `browser-reports-${suffix}` };
  const otherEvent = { id: randomUUID(), slug: `browser-reports-other-${suffix}` };
  const firstSession = { id: randomUUID(), versionId: randomUUID() };
  const secondSession = { id: randomUUID(), versionId: randomUUID() };
  const now = new Date();
  const connection = await database.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, 'Browser report event', $2, 'CONFERENCE', 'America/Los_Angeles', $5, $6, $7),
              ($3, 'Other report event', $4, 'CONFERENCE', 'America/Los_Angeles', $5, $6, $7)`,
      [
        event.id,
        event.slug,
        otherEvent.id,
        otherEvent.slug,
        new Date("2027-06-01T16:00:00.000Z"),
        new Date("2027-06-03T00:00:00.000Z"),
        now,
      ],
    );
    await connection.query(
      `INSERT INTO "program_sessions" ("id", "eventId", "kind", "updatedAt")
       VALUES ($1, $2, 'MANUAL', $4), ($3, $2, 'MANUAL', $4)`,
      [firstSession.id, event.id, secondSession.id, now],
    );
    await connection.query(
      `INSERT INTO "program_session_versions"
         ("id", "eventId", "sessionId", "versionNumber", "title", "durationMinutes")
       VALUES ($1, $2, $3, 1, 'Opening keynote', 45),
              ($4, $2, $5, 1, 'Design lab', 90)`,
      [firstSession.versionId, event.id, firstSession.id, secondSession.versionId, secondSession.id],
    );
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
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
    const reportsUrl = `/dashboard/events/${event.slug}/reports`;
    await page.goto(reportsUrl);
    await expect(page.getByRole("heading", { name: "Report builder" })).toBeVisible();
    await expect(page.getByText("Sessions with speaker details", { exact: true })).toBeVisible();

    const useTemplate = page.getByRole("button", { name: "Use template" }).first();
    await waitForHydration(useTemplate);
    await useTemplate.click();
    await expect(page.getByText("Opening keynote", { exact: true })).toBeVisible();
    await expect(page.getByText("Design lab", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit report" });
    await dialog.getByRole("button", { name: "Add filter" }).click();
    await dialog.getByLabel("Filter 1 value").fill("keynote");
    await dialog.getByRole("button", { name: "Save report" }).click();
    await expect(page.getByText("Opening keynote", { exact: true })).toBeVisible();
    await expect(page.getByText("Design lab", { exact: true })).toHaveCount(0);

    const csvDownloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    expect((await csvDownloadPromise).suggestedFilename()).toBe("sessions-with-speaker-details.csv");
    const xlsxDownloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download XLSX" }).click();
    expect((await xlsxDownloadPromise).suggestedFilename()).toBe("sessions-with-speaker-details.xlsx");

    await page.getByRole("button", { name: "Duplicate" }).click();
    // The duplicate is listed and becomes the selected report, so its name renders twice.
    await expect(page.getByText("Sessions with speaker details copy", { exact: true })).toHaveCount(2);

    // Drop the duplicate's filter so the two saved reports no longer share editor state.
    await page.getByRole("button", { name: "Edit" }).click();
    const duplicateDialog = page.getByRole("dialog", { name: "Edit report" });
    await expect(duplicateDialog.getByLabel("Filter 1 value")).toHaveValue("keynote");
    await duplicateDialog.getByRole("button", { name: "Remove filter" }).click();
    await duplicateDialog.getByRole("button", { name: "Save report" }).click();
    await expect(page.getByText("Design lab", { exact: true })).toBeVisible();

    // Selecting another report must reload the editor instead of keeping the previous report's state.
    await page.getByRole("link", { name: "Sessions with speaker details", exact: true }).click();
    await expect(page.getByText("Design lab", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit" }).click();
    const originalDialog = page.getByRole("dialog", { name: "Edit report" });
    await expect(originalDialog.getByLabel("Filter 1 value")).toHaveValue("keynote");
    await page.keyboard.press("Escape");
    await expect(originalDialog).toBeHidden();

    await page.getByRole("link", { name: "Sessions with speaker details copy", exact: true }).click();
    await expect(page.getByText("Design lab", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete report" }).click();
    await expect(page.getByText("Sessions with speaker details copy", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Opening keynote", { exact: true })).toBeVisible();

    await page.goto(`/dashboard/events/${otherEvent.slug}/reports`);
    await expect(page.getByText("Start from a template", { exact: true })).toBeVisible();
    await expect(page.getByText("Opening keynote", { exact: true })).toHaveCount(0);
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" IN ($1, $2)`, [event.id, otherEvent.id]);
  }
});
