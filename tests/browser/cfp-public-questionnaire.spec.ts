import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { signInAsAdmin } from "./fixtures/magic-link-webhook";
import { randomUUID } from "node:crypto";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: testDatabaseUrl });
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";

test.setTimeout(120_000);

test.afterAll(async () => {
  await database.end();
});

test("finalizes one published submission and shows it in the correct event dashboard", async ({ context, page }) => {
  const eventId = randomUUID();
  const formId = randomUUID();
  const versionId = randomUUID();
  const stepId = randomUUID();
  const categoryId = randomUUID();
  const policyId = randomUUID();
  const publicId = randomUUID();
  const customFieldId = randomUUID();
  const otherEventId = randomUUID();
  const eventSlug = `public-questionnaire-${publicId.slice(0, 8)}`;
  const now = new Date();

  await database.query(
    `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
     VALUES ($1, 'Plan Screen 20 Conference', $2, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5)`,
    [eventId, eventSlug, new Date("2027-03-13"), new Date("2027-03-15"), now],
  );
  await database.query(
    `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
     VALUES ($1, 'Other custom-field event', $2, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5)`,
    [otherEventId, `other-custom-fields-${publicId.slice(0, 8)}`, new Date("2027-04-01"), new Date("2027-04-03"), now],
  );
  await database.query(
    `INSERT INTO "custom_field_definitions"
     ("id", "eventId", "entityType", "key", "label", "type", "required", "position", "updatedAt")
     VALUES ($1, $2, 'CFP_SUBMISSION', 'audience_experience', 'Audience experience', 'SINGLE_LINE_TEXT', true, 0, $5),
            ($3, $4, 'CFP_SUBMISSION', 'private_other_event', 'Private other-event field', 'SINGLE_LINE_TEXT', false, 0, $5)`,
    [customFieldId, eventId, randomUUID(), otherEventId, now],
  );
  await database.query(`INSERT INTO "cfp_forms" ("id", "eventId", "key", "updatedAt") VALUES ($1, $2, 'main', $3)`, [
    formId,
    eventId,
    now,
  ]);
  await database.query(
    `INSERT INTO "cfp_categories" ("id", "eventId", "key", "label", "updatedAt")
     VALUES ($1, $2, 'workshops', 'Workshops', $3)`,
    [categoryId, eventId, now],
  );
  await database.query(
    `INSERT INTO "cfp_form_versions"
     ("id", "formId", "versionNumber", "schemaVersion", "title", "description", "submissionKind", "accessPolicy",
      "termsContent", "consentRequired", "customTypes", "categories", "categoryRules")
     VALUES ($1, $2, 1, 1, 'Share your session', 'Tell us what you want to teach.', 'ABSTRACT', 'OPEN',
             'I agree to the event terms.', true, '[]', $3, $4)`,
    [
      versionId,
      formId,
      JSON.stringify([{ id: "workshops", label: "Workshops" }]),
      JSON.stringify([
        {
          id: "route-workshops",
          categoryId: "workshops",
          when: { logic: "all", conditions: [{ questionId: "format", operator: "equals", value: "workshop" }] },
        },
      ]),
    ],
  );
  await database.query(
    `INSERT INTO "cfp_form_steps" ("id", "versionId", "key", "kind", "title", "description", "sortOrder")
     VALUES ($1, $2, 'proposal', 'questions', 'Proposal details', 'Help reviewers understand your idea.', 0)`,
    [stepId, versionId],
  );

  const questions = [
    ["title", "short_text", "Session title", "A clear, concise title.", true, { minLength: 3 }, null],
    ["abstract", "long_text", "Abstract", null, true, { maxLength: 500 }, null],
    [
      "format",
      "select",
      "Session format",
      null,
      true,
      {
        options: [
          { value: "talk", label: "Talk" },
          { value: "workshop", label: "Workshop" },
        ],
      },
      null,
    ],
    [
      "topics",
      "multi_select",
      "Topics",
      "Choose every topic that applies.",
      true,
      {
        options: [
          { value: "web", label: "Web" },
          { value: "data", label: "Data" },
        ],
      },
      null,
    ],
    ["recording", "checkbox", "Recording permission", null, true, null, null],
    ["duration", "number", "Duration in minutes", null, true, { min: 30, max: 180 }, null],
    ["slides", "url", "Slides URL", null, true, null, null],
    ["email", "email", "Contact email", null, true, null, null],
    ["available", "date", "Available date", null, true, null, null],
    [
      "workshop-needs",
      "long_text",
      "Workshop room needs",
      null,
      true,
      null,
      { logic: "all", conditions: [{ questionId: "format", operator: "equals", value: "workshop" }] },
    ],
  ] as const;

  for (const [sortOrder, question] of questions.entries()) {
    const [key, type, label, description, required, constraints, visibleWhen] = question;
    await database.query(
      `INSERT INTO "cfp_form_questions"
       ("id", "stepId", "key", "type", "label", "description", "required", "constraints", "visibleWhen", "sortOrder")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [randomUUID(), stepId, key, type, label, description, required, constraints, visibleWhen, sortOrder],
    );
  }

  await database.query(
    `INSERT INTO "cfp_policies"
     ("id", "eventId", "key", "publicId", "status", "publishedFormVersionId", "updatedAt")
     VALUES ($1, $2, 'main', $3, 'PUBLISHED', $4, $5)`,
    [policyId, eventId, publicId, versionId, now],
  );
  await database.query(
    `INSERT INTO "cfp_policy_versions"
     ("id", "eventId", "policyId", "versionNumber", "submissionOpensAt", "submissionClosesAt", "draftPolicy",
      "submissionLimits", "messages", "conditionalVisibility")
     VALUES ($1, $2, $3, 1, $4, $5, 'ALLOWED', $6, $7, '[]')`,
    [
      randomUUID(),
      eventId,
      policyId,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
      JSON.stringify({ maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 }),
      JSON.stringify({
        introduction: "Welcome",
        submissionConfirmation: "Thanks **{{recipient.email}}** — your proposal for {{event.name}} is in.",
        closed: "Closed",
        thankYou: "Thank you, {{recipient.email}}, for sharing your proposal with {{event.name}}.",
      }),
    ],
  );

  try {
    await page.goto(`/cfp/${publicId}/start`);
    await expect(page.getByRole("heading", { name: "Share your session" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Proposal details" })).toBeVisible();
    await expect(page.getByText("A clear, concise title.")).toBeVisible();
    await expect(page.getByLabel("Audience experience")).toBeVisible();
    await expect(page.getByLabel("Private other-event field")).toHaveCount(0);
    await expect(page.getByLabel("Workshop room needs", { exact: false })).toBeHidden();

    await page.locator("form").evaluate((form) => {
      form.setAttribute("novalidate", "");
    });
    await page.getByRole("button", { name: "Submit proposal" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "could not submit" })).toBeVisible();
    await expect(page.getByText("This question is required.").first()).toBeVisible();

    await page.getByLabel("Session title", { exact: false }).fill("Schema-driven CFPs");
    await page
      .getByLabel("Abstract", { exact: false })
      .fill("Build one definition and share its semantics end to end.");
    await page.getByLabel("Session format", { exact: false }).selectOption("talk");
    await expect(page.getByLabel("Workshop room needs", { exact: false })).toBeHidden();
    await page.getByLabel("Session format", { exact: false }).selectOption("workshop");
    await expect(page.getByLabel("Workshop room needs", { exact: false })).toBeVisible();
    await page.getByLabel("Topics", { exact: false }).selectOption(["web", "data"]);
    await page.getByLabel("Recording permission", { exact: false }).check();
    await page.getByLabel("Duration in minutes", { exact: false }).fill("90");
    await page.getByLabel("Slides URL", { exact: false }).fill("https://example.com/slides");
    await page.getByLabel("Contact email", { exact: false }).fill("speaker@example.com");
    await page.getByLabel("Available date", { exact: false }).fill("2026-10-05");
    await page.getByLabel("Workshop room needs", { exact: false }).fill("Tables and power outlets");
    await page.getByLabel("I agree to the terms and consent to this submission.").check();
    await page.getByRole("button", { name: "Submit proposal" }).click();
    await expect(page.getByText("Audience experience is required.")).toBeVisible();
    await page.getByLabel("Audience experience").fill("Strategy game enthusiasts");
    await page.locator("form").evaluate((element) => {
      const form = element as HTMLFormElement;
      form.requestSubmit();
      form.requestSubmit();
    });

    await expect(page.getByRole("heading", { name: "Proposal submitted" })).toBeVisible();
    await expect(
      page.getByText("Thanks speaker@example.com — your proposal for Plan Screen 20 Conference is in."),
    ).toBeVisible();
    const submission = await database.query(
      `SELECT s."id", s."kind", s."status", s."submittedAt", r."kind" AS "revisionKind"
       FROM "cfp_submissions" s
       JOIN "cfp_submission_revisions" r ON r."submissionId" = s."id"
       WHERE s."eventId" = $1`,
      [eventId],
    );
    expect(submission.rows).toHaveLength(1);
    expect(submission.rows[0]).toMatchObject({ kind: "ABSTRACT", status: "SUBMITTED", revisionKind: "FINAL" });
    expect(submission.rows[0].submittedAt).toBeInstanceOf(Date);
    const persisted = await database.query(
      `SELECT a."questionId", a."value"
       FROM "cfp_submissions" s
       JOIN "cfp_submission_revisions" r ON r."submissionId" = s."id"
       JOIN "cfp_submission_answers" a ON a."revisionId" = r."id"
       WHERE s."eventId" = $1 AND r."kind" = 'FINAL'
       ORDER BY a."sortOrder"`,
      [eventId],
    );
    expect(persisted.rows).toEqual([
      { questionId: "title", value: "Schema-driven CFPs" },
      { questionId: "abstract", value: "Build one definition and share its semantics end to end." },
      { questionId: "format", value: "workshop" },
      { questionId: "topics", value: ["web", "data"] },
      { questionId: "recording", value: true },
      { questionId: "duration", value: 90 },
      { questionId: "slides", value: "https://example.com/slides" },
      { questionId: "email", value: "speaker@example.com" },
      { questionId: "available", value: "2026-10-05" },
      { questionId: "workshop-needs", value: "Tables and power outlets" },
    ]);
    const routedCategory = await database.query(
      `SELECT "categoryId" FROM "cfp_submission_categories" WHERE "eventId" = $1`,
      [eventId],
    );
    expect(routedCategory.rows).toEqual([{ categoryId }]);
    const customValues = await database.query(
      `SELECT d."label", v."value"
       FROM "custom_field_values" v
       JOIN "custom_field_definitions" d ON d."id" = v."definitionId"
       WHERE v."eventId" = $1`,
      [eventId],
    );
    expect(customValues.rows).toEqual([{ label: "Audience experience", value: "Strategy game enthusiasts" }]);
    const thankYou = await database.query(
      `SELECT d."idempotencyKey", r."email", r."subjectSnapshot", r."textSnapshot"
       FROM "message_deliveries" d
       JOIN "message_recipients" r ON r."deliveryId" = d."id"
       WHERE d."eventId" = $1`,
      [eventId],
    );
    expect(thankYou.rows).toHaveLength(1);
    expect(thankYou.rows[0]).toMatchObject({
      email: "speaker@example.com",
      subjectSnapshot: "Submission received: Schema-driven CFPs — Plan Screen 20 Conference",
    });
    expect(thankYou.rows[0].textSnapshot).toContain(
      "Thank you, speaker@example.com, for sharing your proposal with Plan Screen 20 Conference.",
    );
    expect(thankYou.rows[0].idempotencyKey).toBe(`cfp-thank-you:${submission.rows[0].id}`);

    await signInAsAdmin(page);
    await context.addCookies([{ name: "gatherpulse_active_event", value: eventId, url: baseURL }]);
    await page.goto(`/dashboard/events/${eventSlug}/submissions`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.getByText("Share your session")).toBeVisible();
    await expect(page.getByRole("link", { name: "Submitted 1" })).toBeVisible();
    await page.goto(`/dashboard/events/${eventSlug}/submissions/${submission.rows[0].id}`);
    await expect(page.getByText("Additional information", { exact: true })).toBeVisible();
    await expect(page.getByText("Strategy game enthusiasts")).toBeVisible();
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" = $1`, [eventId]);
    await database.query(`DELETE FROM "events" WHERE "id" = $1`, [otherEventId]);
  }
});
