import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { signInAsAdmin } from "./fixtures/magic-link-webhook";
import { waitForHydration } from "./helpers/hydration";
import { randomUUID } from "node:crypto";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: testDatabaseUrl });

test.setTimeout(120_000);

test.afterAll(async () => {
  await database.end();
});

test("selects records, confirms the count, reports a partial failure, audits changes, and isolates events", async ({
  context,
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const eventId = randomUUID();
  const eventSlug = `bulk-edit-${suffix}`;
  const otherEventId = randomUUID();
  const contactIds = [randomUUID(), randomUUID()];
  const otherContactId = randomUUID();
  const customFieldDefinitionIds = [randomUUID(), randomUUID()];
  const customFieldValueIds = [randomUUID(), randomUUID(), randomUUID()];
  const groupIds = [randomUUID(), randomUUID()];
  const sessionIds = [randomUUID(), randomUUID()];
  const versionIds = [randomUUID(), randomUUID()];
  const now = new Date();
  const seed = await database.connect();
  await seed.query("BEGIN");
  try {
    await seed.query(
      `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, 'Bulk Edit Summit', $2, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5),
              ($6, 'Other Bulk Event', $7, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5)`,
      [
        eventId,
        eventSlug,
        new Date("2027-05-10T16:00:00.000Z"),
        new Date("2027-05-12T00:00:00.000Z"),
        now,
        otherEventId,
        `other-bulk-${suffix}`,
      ],
    );
    await seed.query(
      `INSERT INTO "contacts" ("id", "eventId", "email", "givenName", "familyName", "updatedAt")
       VALUES ($1, $2, 'ada-${suffix}@example.test', 'Ada', 'Lovelace', $6),
              ($3, $2, 'grace-${suffix}@example.test', 'Grace', 'Hopper', $6),
              ($4, $5, 'secret-${suffix}@example.test', 'Secret', 'Contact', $6)`,
      [contactIds[0], eventId, contactIds[1], otherContactId, otherEventId, now],
    );
    await seed.query(
      `INSERT INTO "custom_field_definitions"
         ("id", "eventId", "entityType", "key", "label", "type", "position", "updatedAt")
       VALUES ($1, $2, 'CONTACT', 'dietary-preference', 'Dietary preference', 'SINGLE_LINE_TEXT', 0, $5),
              ($3, $4, 'CONTACT', 'dietary-preference', 'Dietary preference', 'SINGLE_LINE_TEXT', 0, $5)`,
      [customFieldDefinitionIds[0], eventId, customFieldDefinitionIds[1], otherEventId, now],
    );
    await seed.query(
      `INSERT INTO "custom_field_values"
         ("id", "eventId", "definitionId", "contactId", "value", "normalizedText", "updatedAt")
       VALUES ($1, $2, $3, $4, '"Vegetarian"'::jsonb, 'vegetarian', $9),
              ($5, $2, $3, $6, '"Omnivore"'::jsonb, 'omnivore', $9),
              ($7, $8, $10, $11, '"Vegetarian"'::jsonb, 'vegetarian', $9)`,
      [
        customFieldValueIds[0],
        eventId,
        customFieldDefinitionIds[0],
        contactIds[0],
        customFieldValueIds[1],
        contactIds[1],
        customFieldValueIds[2],
        otherEventId,
        now,
        customFieldDefinitionIds[1],
        otherContactId,
      ],
    );
    await seed.query(
      `INSERT INTO "contact_groups" ("id", "eventId", "kind", "name", "slug", "updatedAt")
       VALUES ($1, $2, 'SPONSOR', 'Gold', $4, $6),
              ($3, $2, 'SPONSOR', 'Silver', $5, $6)`,
      [groupIds[0], eventId, groupIds[1], `gold-${suffix}`, `silver-${suffix}`, now],
    );
    await seed.query(
      `INSERT INTO "program_sessions" ("id", "eventId", "kind", "updatedAt")
       VALUES ($1, $2, 'MANUAL', $4), ($3, $2, 'MANUAL', $4)`,
      [sessionIds[0], eventId, sessionIds[1], now],
    );
    await seed.query(
      `INSERT INTO "program_session_versions"
         ("id", "eventId", "sessionId", "versionNumber", "title", "durationMinutes")
       VALUES ($1, $2, $3, 1, 'Opening keynote', 30),
              ($4, $2, $5, 1, 'Closing panel', 45)`,
      [versionIds[0], eventId, sessionIds[0], versionIds[1], sessionIds[1]],
    );
    await seed.query("COMMIT");
  } catch (error) {
    await seed.query("ROLLBACK");
    throw error;
  } finally {
    seed.release();
  }

  try {
    await signInAsAdmin(page);
    await context.addCookies([
      {
        name: "gatherpulse_active_event",
        value: eventId,
        domain: "127.0.0.1",
        path: "/dashboard",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`/dashboard/events/${eventSlug}/records`);
    await expect(page.getByRole("heading", { name: "Bulk edit records" })).toBeVisible();
    await expect(page.getByText("Secret Contact")).toHaveCount(0);

    await page.getByLabel("Custom field").selectOption({ label: "Dietary preference" });
    await page.getByLabel("Value contains").fill("vegetarian");
    await page.getByRole("button", { name: "Apply filter" }).click();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByText("Grace Hopper")).toHaveCount(0);
    await expect(page.getByText("Secret Contact")).toHaveCount(0);
    await expect(page.getByRole("cell", { name: /Dietary preference Vegetarian/ })).toBeVisible();
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page.getByText("Grace Hopper")).toBeVisible();

    const ada = page.getByRole("checkbox", { name: "Select Ada Lovelace" });
    await waitForHydration(ada);
    await ada.click();
    await page.getByRole("checkbox", { name: "Select Grace Hopper" }).click();
    await page.getByLabel("New value").fill("Board Guild");
    await page.getByRole("button", { name: "Review bulk edit" }).click();
    const contactDialog = page.getByRole("alertdialog");
    await expect(contactDialog).toContainText("Update 2 records?");
    await database.query(`DELETE FROM "contacts" WHERE "id" = $1`, [contactIds[1]]);
    await contactDialog.getByRole("button", { name: "Apply to 2 records" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Some records were not updated" })).toContainText(
      "1 of 2 records updated.",
    );

    await page.getByLabel("Groups", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Select all groups" }).click();
    await page.getByLabel("New value").fill("Partner");
    await page.getByRole("button", { name: "Review bulk edit" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Apply to 2 records" }).click();
    await expect(page.getByText("2 records updated.")).toBeVisible();

    await page.getByLabel("Sessions", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Select all sessions" }).click();
    await page.getByLabel("Field", { exact: true }).click();
    await page.getByRole("option", { name: "Duration (minutes)" }).click();
    await page.getByLabel("New value").fill("60");
    await page.getByRole("button", { name: "Review bulk edit" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Apply to 2 records" }).click();
    await expect(page.getByText("2 records updated.")).toBeVisible();

    const [contact, outsider, groups, durations, audits] = await Promise.all([
      database.query<{ organization: string | null }>(`SELECT "organization" FROM "contacts" WHERE "id" = $1`, [
        contactIds[0],
      ]),
      database.query<{ organization: string | null }>(`SELECT "organization" FROM "contacts" WHERE "id" = $1`, [
        otherContactId,
      ]),
      database.query<{ name: string }>(`SELECT "name" FROM "contact_groups" WHERE "eventId" = $1 ORDER BY "slug"`, [
        eventId,
      ]),
      database.query<{ durationMinutes: number }>(
        `SELECT v."durationMinutes" FROM "program_session_versions" v
         WHERE v."eventId" = $1 AND v."versionNumber" = 2 ORDER BY v."title"`,
        [eventId],
      ),
      database.query<{ requestedCount: number; succeededCount: number }>(
        `SELECT "requestedCount", "succeededCount" FROM "bulk_edit_operations"
         WHERE "eventId" = $1 ORDER BY "createdAt"`,
        [eventId],
      ),
    ]);
    expect(contact.rows[0]?.organization).toBe("Board Guild");
    expect(outsider.rows[0]?.organization).toBeNull();
    expect(groups.rows.map(({ name }) => name)).toEqual(["Partner", "Partner"]);
    expect(durations.rows.map(({ durationMinutes }) => durationMinutes)).toEqual([60, 60]);
    expect(audits.rows).toEqual([
      { requestedCount: 2, succeededCount: 1 },
      { requestedCount: 2, succeededCount: 2 },
      { requestedCount: 2, succeededCount: 2 },
    ]);
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" IN ($1, $2)`, [eventId, otherEventId]);
  }
});
