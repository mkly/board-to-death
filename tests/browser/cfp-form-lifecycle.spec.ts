import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { signInAsAdmin } from "./fixtures/magic-link-webhook";
import { randomUUID } from "node:crypto";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: testDatabaseUrl });

// Signing in and rendering a dashboard route compiles on demand under the dev
// web server, which does not fit Playwright's 30s default (agenda.spec.ts already
// raises it for the same reason).
test.setTimeout(120_000);

test.afterAll(async () => {
  await database.end();
});

test("duplicates, closes, reopens, and archives an event-scoped CFP form with confirmation", async ({
  context,
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const eventId = randomUUID();
  const otherEventId = randomUUID();
  const eventSlug = `browser-cfp-${suffix}`;
  const formId = randomUUID();
  const formVersionId = randomUUID();
  const formStepId = randomUUID();
  const policyId = randomUUID();
  const publicId = randomUUID();
  const policyVersionId = randomUUID();
  const administratorId = randomUUID();
  const submissionId = randomUUID();
  const now = new Date();

  const seedConnection = await database.connect();
  await seedConnection.query("BEGIN");
  try {
    for (const [id, name, slug] of [
      [eventId, "Browser CFP event", eventSlug],
      [otherEventId, "Other CFP event", `other-cfp-${suffix}`],
    ]) {
      await seedConnection.query(
        `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
         VALUES ($1, $2, $3, 'CONFERENCE', 'America/Los_Angeles', $4, $5, $6)`,
        [id, name, slug, new Date("2027-03-13T17:00:00.000Z"), new Date("2027-03-15T00:00:00.000Z"), now],
      );
    }
    await seedConnection.query(
      `INSERT INTO "cfp_forms" ("id", "eventId", "key", "updatedAt") VALUES
       ($1, $2, 'main-cfp', $4),
       ($3, $5, 'foreign-cfp', $4)`,
      [formId, eventId, randomUUID(), now, otherEventId],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_form_versions"
       ("id", "formId", "versionNumber", "schemaVersion", "title", "description", "customTypes")
       VALUES ($1, $2, 1, 1, 'Main CFP', 'Browser lifecycle fixture', '[]')`,
      [formVersionId, formId],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_form_steps" ("id", "versionId", "key", "kind", "title", "sortOrder")
       VALUES ($1, $2, 'proposal', 'questions', 'Proposal', 0)`,
      [formStepId, formVersionId],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_administrators" ("id", "eventId", "externalId", "displayName", "updatedAt")
       VALUES ($1, $2, 'admin@example.test', 'Browser Admin', $3)`,
      [administratorId, eventId, now],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_policies" ("id", "eventId", "key", "publicId", "status", "updatedAt")
       VALUES ($1, $2, 'main-cfp', $3, 'PUBLISHED', $4)`,
      [policyId, eventId, publicId, now],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_policy_versions"
       ("id", "eventId", "policyId", "versionNumber", "submissionOpensAt", "submissionClosesAt", "draftPolicy",
        "submissionLimits", "messages", "conditionalVisibility")
       VALUES ($1, $2, $3, 1, $4, $5, 'ALLOWED', $6, $7, '[]')`,
      [
        policyVersionId,
        eventId,
        policyId,
        new Date("2026-09-01T16:00:00.000Z"),
        new Date("2026-11-01T07:00:00.000Z"),
        JSON.stringify({ maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 }),
        JSON.stringify({ introduction: "Welcome", submissionConfirmation: "Submitted", closed: "Closed" }),
      ],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_policy_admin_assignments" ("eventId", "versionId", "administratorId", "role")
       VALUES ($1, $2, $3, 'OWNER')`,
      [eventId, policyVersionId, administratorId],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_policy_transitions" ("id", "eventId", "policyId", "fromStatus", "toStatus")
       VALUES ($1, $2, $3, 'DRAFT', 'PUBLISHED')`,
      [randomUUID(), eventId, policyId],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_submissions" ("id", "eventId", "formVersionId", "kind", "updatedAt")
       VALUES ($1, $2, $3, 'ABSTRACT', $4)`,
      [submissionId, eventId, formVersionId, now],
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
    // CFP status transitions match `cfp_administrators.externalId` against the signed-in Better Auth
    // user id, not the account's email address, so the seeded administrator is rebound to that id.
    const adminUser = await database.query<{ id: string }>(`SELECT "id" FROM "user" WHERE "email" = $1`, [
      "admin@example.test",
    ]);
    const adminUserId = adminUser.rows[0]?.id;
    if (!adminUserId) throw new Error("Expected the browser admin account to exist after signing in.");
    await database.query(`UPDATE "cfp_administrators" SET "externalId" = $1 WHERE "id" = $2`, [
      adminUserId,
      administratorId,
    ]);
    await context.addCookies([
      {
        name: "board_to_death_active_event",
        value: eventId,
        domain: "127.0.0.1",
        path: "/dashboard",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto(`/dashboard/events/${eventSlug}/cfp`);
    await expect(page.getByRole("heading", { name: "CFP forms" })).toBeVisible();
    await expect(page.getByText("Main CFP")).toBeVisible();
    await expect(page.getByText("foreign-cfp")).toHaveCount(0);

    await page.getByRole("button", { name: "Actions for Main CFP" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Existing responses are not copied");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Copy of Main CFP")).toHaveCount(0);

    await page.getByRole("button", { name: "Actions for Main CFP" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.getByRole("button", { name: "Duplicate form" }).click();
    await expect(page.getByText("CFP form duplicated as a new draft.")).toBeVisible();
    await expect(page.getByText("Copy of Main CFP")).toBeVisible();

    const duplicate = await database.query<{ formId: string; publicId: string; responseCount: string }>(
      `SELECT f."id" AS "formId", p."publicId", COUNT(s."id")::text AS "responseCount"
       FROM "cfp_forms" f
       JOIN "cfp_policies" p ON p."eventId" = f."eventId" AND p."key" = f."key"
       JOIN "cfp_form_versions" v ON v."formId" = f."id"
       LEFT JOIN "cfp_submissions" s ON s."formVersionId" = v."id"
       WHERE f."eventId" = $1 AND f."id" <> $2
       GROUP BY f."id", p."publicId"`,
      [eventId, formId],
    );
    expect(duplicate.rows).toHaveLength(1);
    expect(duplicate.rows[0]?.publicId).not.toBe(publicId);
    expect(duplicate.rows[0]?.responseCount).toBe("0");

    await page.getByRole("button", { name: "Actions for Main CFP" }).click();
    await page.getByRole("menuitem", { name: "Close" }).click();
    await page.getByRole("button", { name: "Close form" }).click();
    await expect(page.getByText("CFP form closed.")).toBeVisible();
    await expect(page.getByRole("row", { name: /^Main CFP Version/ })).toContainText("Closed");

    await page.getByRole("button", { name: "Actions for Main CFP" }).click();
    await page.getByRole("menuitem", { name: "Reopen" }).click();
    await page.getByRole("button", { name: "Reopen form" }).click();
    await expect(page.getByText("CFP form reopened.")).toBeVisible();

    await page.getByRole("button", { name: "Actions for Main CFP" }).click();
    await page.getByRole("menuitem", { name: "Close" }).click();
    await page.getByRole("button", { name: "Close form" }).click();
    await page.getByRole("button", { name: "Actions for Main CFP" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.getByRole("button", { name: "Archive form" }).click();
    await expect(page.getByText("CFP form archived.")).toBeVisible();
    await expect(page.getByRole("row", { name: /^Main CFP Version/ })).toContainText("Archived");

    await page.getByRole("button", { name: "Actions for Main CFP" }).click();
    await expect(page.getByRole("menuitem", { name: "Reopen" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Archive" })).toHaveCount(0);
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" = ANY($1::uuid[])`, [[eventId, otherEventId]]);
  }
});
