import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { signInAsAdmin } from "./fixtures/magic-link-webhook";
import { randomUUID } from "node:crypto";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: testDatabaseUrl });

test.afterAll(async () => {
  await database.end();
});

test("creates, edits, reorders, locks, and reloads an event-scoped rubric", async ({ context, page }) => {
  const suffix = randomUUID().slice(0, 8);
  const event = { id: randomUUID(), slug: `browser-rubric-${suffix}` };
  const planId = randomUUID();
  const versionId = randomUUID();
  const roundId = randomUUID();
  const now = new Date();

  const seedConnection = await database.connect();
  await seedConnection.query("BEGIN");
  try {
    await seedConnection.query(
      `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, 'Browser rubric event', $2, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5)`,
      [event.id, event.slug, new Date("2027-03-13T17:00:00.000Z"), new Date("2027-03-15T00:00:00.000Z"), now],
    );
    await seedConnection.query(
      `INSERT INTO "evaluation_plans" ("id", "eventId", "key", "updatedAt")
       VALUES ($1, $2, 'main-evaluation', $3)`,
      [planId, event.id, now],
    );
    await seedConnection.query(
      `INSERT INTO "evaluation_plan_versions" ("id", "planId", "versionNumber", "title", "updatedAt")
       VALUES ($1, $2, 1, 'Browser evaluation plan', $3)`,
      [versionId, planId, now],
    );
    await seedConnection.query(
      `INSERT INTO "evaluation_rounds" ("id", "planVersionId", "key", "title", "sortOrder", "updatedAt")
       VALUES ($1, $2, 'review', 'Review', 0, $3)`,
      [roundId, versionId, now],
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

    await page.goto(`/dashboard/events/${event.slug}/evaluations`);
    await expect(page.getByRole("heading", { name: "Evaluation rubrics" })).toBeVisible();
    await page.getByRole("button", { name: "Add default rubric" }).click();
    await expect(page.getByText("Default 1-to-5 rubric added.")).toBeVisible();
    await expect(page.getByLabel("Label").nth(0)).toHaveValue("Relevance");
    await expect(page.getByLabel("Label").nth(1)).toHaveValue("Technical Depth");
    await expect(page.getByLabel("Label").nth(2)).toHaveValue("Speaker Authority");

    await page.getByLabel("Label").nth(1).fill("Technical rigor");
    await page.getByLabel("Reviewer guidance").nth(1).fill("Assess specificity and practical depth.");
    await page.getByLabel("Weight").nth(1).fill("2");
    await page.getByLabel("Required criterion").nth(1).uncheck();
    await page.getByRole("button", { name: "Save criterion" }).nth(1).click();
    await expect(page.getByText("Rubric criterion saved.")).toBeVisible();
    await expect(page.getByLabel("Required criterion").nth(1)).not.toBeChecked();

    await page.getByRole("button", { name: "Move Technical rigor up" }).click();
    await expect(page.getByText("Criterion order updated.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Label").nth(0)).toHaveValue("Technical rigor");
    await expect(page.getByLabel("Weight").nth(0)).toHaveValue("2");

    await database.query(
      `UPDATE "evaluation_plan_versions"
       SET "status" = 'ACTIVE', "activatedAt" = $1, "updatedAt" = $1
       WHERE "id" = $2`,
      [new Date(), versionId],
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Save criterion" })).toHaveCount(0);
    await expect(page.getByLabel("Label").nth(0)).toBeDisabled();
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" = $1`, [event.id]);
  }
});
