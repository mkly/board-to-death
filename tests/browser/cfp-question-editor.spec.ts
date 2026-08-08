import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const eventSlug = "question-editor-conference";
const formId = randomUUID();
const webhookPort = 3199;
const database = new Client({ connectionString: databaseUrl });
let webhook: Server;
let resolveMagicLink: ((url: string) => void) | undefined;

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

test.beforeAll(async () => {
  webhook = createServer(async (request, response) => {
    const body = JSON.parse(await readRequestBody(request)) as { text?: string };
    const link = body.text?.match(/https?:\/\/\S+/)?.[0];
    if (link) resolveMagicLink?.(link);
    response.writeHead(204).end();
  });
  await new Promise<void>((resolve) => webhook.listen(webhookPort, "127.0.0.1", resolve));

  await database.connect();
  await database.query('DELETE FROM "events"');
  const eventId = randomUUID();
  const versionId = randomUUID();
  const stepId = randomUUID();
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
});

test.afterAll(async () => {
  await database.end();
  await new Promise<void>((resolve, reject) => webhook.close((error) => (error ? reject(error) : resolve())));
});

test("configures, validates, reorders, removes, saves, and restores CFP questions", async ({ page }) => {
  const magicLink = new Promise<string>((resolve) => {
    resolveMagicLink = resolve;
  });
  await page.goto("/auth/v1/login");
  await page.getByRole("textbox", { name: "Email address" }).fill("admin@example.test");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.goto(await magicLink);
  await page.goto(`/dashboard/events/${eventSlug}/cfp/forms/${formId}/setup`);

  await expect(page.getByRole("heading", { name: "Board Game Design CFP" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
  await expect(page.getByText("Version 1")).toBeVisible();

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

  await page.getByRole("button", { name: "Move Audience experience up" }).click();
  await page.getByRole("button", { name: "Remove Abstract" }).click();
  await expect(page.getByRole("heading", { name: "Remove this question?" })).toBeVisible();
  await page.getByRole("button", { name: "Remove question" }).click();

  await page.getByRole("button", { name: "Save questions" }).click();
  await expect(page.getByText("Questions saved as version 2.").first()).toBeVisible();
  await expect(page.getByText("Version 2")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Version 2")).toBeVisible();
  await expect(page.getByLabel("Label").first()).toHaveValue("Audience experience");
  await expect(page.getByLabel("Label").nth(1)).toHaveValue("Format");
  await expect(page.getByLabel("Custom type identifier")).toHaveValue("audience_scale");
  await expect(page.getByRole("switch", { name: "Required answer" }).first()).toBeChecked();
  await expect(page.getByText("Abstract", { exact: true })).toHaveCount(0);

  const persisted = await database.query<{
    customTypes: string[];
    key: string;
    required: boolean;
    sortOrder: number;
    type: string;
    versionNumber: number;
  }>(
    `SELECT v."versionNumber", v."customTypes", q."key", q."type", q."required", q."sortOrder"
       FROM "cfp_form_versions" v
       JOIN "cfp_form_steps" s ON s."versionId" = v."id"
       JOIN "cfp_form_questions" q ON q."stepId" = s."id"
      WHERE v."formId" = $1 AND v."versionNumber" = 2
      ORDER BY q."sortOrder"`,
    [formId],
  );
  expect(persisted.rows.map(({ key }) => key)).toEqual(["audience-experience", "format"]);
  expect(persisted.rows[0]).toMatchObject({ type: "audience_scale", required: true, versionNumber: 2 });
  expect(persisted.rows[0]?.customTypes).toContain("audience_scale");
});
