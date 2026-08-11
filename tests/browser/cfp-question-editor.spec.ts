import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { signInAsAdmin } from "./fixtures/magic-link-webhook";
import { randomUUID } from "node:crypto";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const eventId = randomUUID();
const eventSlug = `question-editor-conference-${randomUUID().slice(0, 8)}`;
const formId = randomUUID();
const database = new Client({ connectionString: databaseUrl });

test.setTimeout(120_000);

test.beforeAll(async () => {
  await database.connect();
  const versionId = randomUUID();
  const stepId = randomUUID();
  await database.query("BEGIN");
  try {
    await database.query(
      `INSERT INTO "events"
        ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, $2, $3, 'CONFERENCE', $4, $5, $6, NOW())`,
      [
        eventId,
        "Question Editor Conference",
        eventSlug,
        "America/Los_Angeles",
        new Date("2027-03-13T17:00:00.000Z"),
        new Date("2027-03-15T00:00:00.000Z"),
      ],
    );
    await database.query('INSERT INTO "cfp_forms" ("id", "eventId", "key", "updatedAt") VALUES ($1, $2, $3, NOW())', [
      formId,
      eventId,
      "main-cfp",
    ]);
    await database.query(
      `INSERT INTO "cfp_form_versions"
        ("id", "formId", "versionNumber", "schemaVersion", "title", "customTypes")
       VALUES ($1, $2, 1, 1, $3, '[]'::jsonb)`,
      [versionId, formId, "Board Game Design CFP"],
    );
    await database.query(
      `INSERT INTO "cfp_form_steps" ("id", "versionId", "key", "kind", "title", "sortOrder")
       VALUES ($1, $2, 'proposal', 'questions', 'Proposal', 0)`,
      [stepId, versionId],
    );
    await database.query(
      `INSERT INTO "cfp_form_questions"
        ("id", "stepId", "key", "type", "label", "required", "sortOrder")
       VALUES ($1, $2, 'abstract', 'long_text', 'Abstract', true, 0)`,
      [randomUUID(), stepId],
    );
    await database.query(
      `INSERT INTO "cfp_form_questions"
        ("id", "stepId", "key", "type", "label", "required", "constraints", "sortOrder")
       VALUES ($1, $2, 'format', 'select', 'Format', true, $3::jsonb, 1)`,
      [
        randomUUID(),
        stepId,
        JSON.stringify({
          options: [
            { value: "talk", label: "Talk" },
            { value: "workshop", label: "Workshop" },
          ],
        }),
      ],
    );
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  }
});

test.afterAll(async () => {
  try {
    await database.query('DELETE FROM "events" WHERE "id" = $1', [eventId]);
  } finally {
    await database.end();
  }
});

test("configures, validates, reorders, removes, saves, and restores CFP questions", async ({
  baseURL,
  context,
  page,
}) => {
  await signInAsAdmin(page);
  await context.addCookies([
    {
      name: "gatherpulse_active_event",
      value: eventId,
      domain: new URL(baseURL ?? "http://127.0.0.1:3100").hostname,
      path: "/dashboard",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`/dashboard/events/${eventSlug}/cfp/forms/${formId}/setup`);

  await expect(page.getByRole("heading", { name: "Board Game Design CFP" })).toBeVisible();
  await page.getByLabel("Form name").fill("Updated Board Game Design CFP");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("Review the question definition")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save questions" })).toBeDisabled();

  const labels = page.getByLabel("Label");
  const identifiers = page.getByLabel("Stable identifier");
  await labels.last().fill("Audience experience");
  await identifiers.last().fill("audience-experience");
  await page.getByLabel("Answer type").last().click();
  for (const typeName of [
    "Short text",
    "Long text",
    "Single select",
    "Multi-select",
    "Checkbox",
    "Number",
    "URL",
    "Email",
    "Date",
    "Custom type",
  ]) {
    await expect(page.getByRole("option", { name: typeName })).toBeVisible();
  }
  await page.getByRole("option", { name: "Custom type" }).click();
  await page.getByLabel("Custom type identifier").fill("audience_scale");
  await page.getByRole("switch", { name: "Required answer" }).last().click();
  await page.getByRole("switch", { name: "Conditional visibility" }).last().click();
  await page.getByLabel("Source question").click();
  await page.getByRole("option", { name: "Format" }).click();
  await page.getByLabel("Comparison value").click();
  await page.getByRole("option", { name: "Workshop" }).click();

  await page.getByRole("button", { name: "Move Audience experience up" }).click();
  await page.getByRole("button", { name: "Remove Abstract" }).click();
  await expect(page.getByRole("heading", { name: "Remove this question?" })).toBeVisible();
  await page.getByRole("button", { name: "Remove question" }).click();

  await page.getByRole("button", { name: "Save questions" }).click();
  await expect(page.getByText("Questions saved as version 3.").first()).toBeVisible();
  await expect(page.getByText("Version 3", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Updated Board Game Design CFP" })).toBeVisible();
  await page.getByRole("tab", { name: "Questions" }).click();
  await expect(page.getByText("Version 3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Label").first()).toHaveValue("Audience experience");
  await expect(page.getByLabel("Label").nth(1)).toHaveValue("Format");
  await expect(page.getByLabel("Custom type identifier")).toHaveValue("audience_scale");
  await expect(page.getByRole("switch", { name: "Required answer" }).first()).toBeChecked();
  await expect(page.getByRole("switch", { name: "Conditional visibility" }).first()).toBeChecked();
  await expect(page.getByLabel("Source question")).toHaveText("Format");
  await expect(page.getByLabel("Comparison value")).toHaveText("Workshop");
  await expect(page.getByText("Abstract", { exact: true })).toHaveCount(0);

  const persisted = await database.query<{
    customTypes: string[];
    key: string;
    required: boolean;
    sortOrder: number;
    title: string;
    type: string;
    versionNumber: number;
    visibleWhen: unknown;
  }>(
    `SELECT v."versionNumber", v."title", v."customTypes", q."key", q."type", q."required", q."sortOrder", q."visibleWhen"
       FROM "cfp_form_versions" v
       JOIN "cfp_form_steps" s ON s."versionId" = v."id"
       JOIN "cfp_form_questions" q ON q."stepId" = s."id"
      WHERE v."formId" = $1 AND v."versionNumber" = 3
      ORDER BY q."sortOrder"`,
    [formId],
  );
  expect(persisted.rows.map(({ key }) => key)).toEqual(["audience-experience", "format"]);
  expect(persisted.rows[0]).toMatchObject({
    type: "audience_scale",
    required: true,
    title: "Updated Board Game Design CFP",
    versionNumber: 3,
  });
  expect(persisted.rows[0]?.customTypes).toContain("audience_scale");
  expect(persisted.rows[0]?.visibleWhen).toEqual({
    logic: "all",
    conditions: [{ questionId: "format", operator: "equals", value: "workshop" }],
  });
});
