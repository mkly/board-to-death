import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { waitForHydration } from "./helpers/hydration.ts";
import { randomUUID } from "node:crypto";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: testDatabaseUrl });

test.setTimeout(120_000);

test.afterAll(async () => {
  await database.end();
});

test("collects one or two ordered speakers and preserves their state through validation", async ({ page }) => {
  const eventId = randomUUID();
  const formId = randomUUID();
  const versionId = randomUUID();
  const stepId = randomUUID();
  const policyId = randomUUID();
  const publicId = randomUUID();
  const eventSlug = `cfp-speakers-${publicId.slice(0, 8)}`;
  const now = new Date();

  await database.query(
    `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
     VALUES ($1, 'Multi-speaker Conference', $2, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5)`,
    [eventId, eventSlug, new Date("2027-03-13"), new Date("2027-03-15"), now],
  );
  await database.query(`INSERT INTO "cfp_forms" ("id", "eventId", "key", "updatedAt") VALUES ($1, $2, 'main', $3)`, [
    formId,
    eventId,
    now,
  ]);
  await database.query(
    `INSERT INTO "cfp_form_versions"
     ("id", "formId", "versionNumber", "schemaVersion", "title", "submissionKind", "accessPolicy",
      "minimumSpeakerCount", "maximumSpeakerCount", "requiredSpeakerFields", "customTypes")
     VALUES ($1, $2, 1, 1, 'Share your session', 'ABSTRACT', 'OPEN', 1, 2, $3, '[]')`,
    [versionId, formId, JSON.stringify(["biography", "contact", "consent"])],
  );
  await database.query(
    `INSERT INTO "cfp_form_steps" ("id", "versionId", "key", "kind", "title", "sortOrder")
     VALUES ($1, $2, 'proposal', 'questions', 'Proposal', 0)`,
    [stepId, versionId],
  );
  await database.query(
    `INSERT INTO "cfp_form_questions" ("id", "stepId", "key", "type", "label", "required", "sortOrder")
     VALUES ($1, $2, 'title', 'short_text', 'Session title', true, 0)`,
    [randomUUID(), stepId],
  );
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
      JSON.stringify({ maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 2 }),
      JSON.stringify({
        introduction: "Welcome",
        submissionConfirmation: "Submitted",
        closed: "Closed",
        portalHandoff: { autoRedirect: true, redirectDelaySeconds: 60 },
      }),
    ],
  );

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/cfp/${publicId}/start`);

    const speakerField = (index: number, field: string) => page.locator(`[name="speaker.${index}.${field}"]`);
    await waitForHydration(speakerField(0, "givenName"));
    await speakerField(0, "givenName").fill("Alex");
    await speakerField(0, "familyName").fill("Rivera");
    await speakerField(0, "email").fill("alex@example.test");
    await speakerField(0, "phone").fill("+1 555 0100");
    await speakerField(0, "biography").fill("Designs cooperative games.");
    await page.getByRole("checkbox", { name: "Speaker profile consent *" }).nth(0).check();
    await page.getByLabel("Session title", { exact: false }).fill("Cooperative systems");

    await page.getByRole("button", { name: "Add speaker" }).click();
    await expect(page.getByRole("button", { name: "Add speaker" })).toBeDisabled();
    await page.getByRole("button", { name: "Remove speaker 2" }).click();
    await expect(speakerField(0, "givenName")).toHaveValue("Alex");
    await expect(page.getByRole("button", { name: "Remove speaker 1" })).toBeDisabled();

    await page.getByRole("button", { name: "Add speaker" }).click();
    await speakerField(1, "givenName").fill("Sam");
    await speakerField(1, "familyName").fill("Lee");
    await speakerField(1, "email").fill("ALEX@EXAMPLE.TEST");
    await speakerField(1, "phone").fill("+1 555 0200");
    await speakerField(1, "biography").fill("Builds accessible party games.");
    await page.getByRole("checkbox", { name: "Speaker profile consent *" }).nth(1).check();
    await page.getByRole("button", { name: "Submit proposal" }).click();

    await expect(page.getByText("Each speaker needs a unique email.")).toBeVisible();
    await expect(speakerField(0, "biography")).toHaveValue("Designs cooperative games.");
    await expect(speakerField(1, "givenName")).toHaveValue("Sam");
    await expect(page.getByRole("checkbox", { name: "Speaker profile consent *" }).nth(1)).toBeChecked();
    await expect(page.getByLabel("Session title", { exact: false })).toHaveValue("Cooperative systems");

    await speakerField(1, "email").fill("sam@example.test");
    await page.getByRole("button", { name: "Submit proposal" }).click();
    await expect(page.getByRole("heading", { name: "Proposal submitted" })).toBeVisible();
    await expect(page.getByText(/Opening the speaker portal in \d+ seconds\./)).toBeVisible();
    await page.getByRole("button", { name: "Cancel automatic redirect" }).click();
    await expect(page.getByText("Automatic redirect cancelled.")).toBeVisible();

    const session = await database.query(
      `SELECT p."sortOrder", s."id" AS "speakerId", COUNT(ss."id")::int AS "sessionCount"
       FROM "cfp_submission_participants" p
       JOIN "speakers" s ON s."id" = p."speakerId"
       LEFT JOIN "speaker_sessions" ss ON ss."eventId" = s."eventId" AND ss."speakerId" = s."id"
       WHERE p."eventId" = $1
       GROUP BY p."sortOrder", s."id"
       ORDER BY p."sortOrder"`,
      [eventId],
    );
    expect(session.rows.map(({ sessionCount, sortOrder }) => ({ sessionCount, sortOrder }))).toEqual([
      { sessionCount: 1, sortOrder: 0 },
      { sessionCount: 0, sortOrder: 1 },
    ]);

    const fallback = await database.query(
      `SELECT r."textSnapshot"
       FROM "message_deliveries" d
       JOIN "message_recipients" r ON r."deliveryId" = d."id"
       WHERE d."eventId" = $1`,
      [eventId],
    );
    expect(fallback.rows[0]?.textSnapshot).toContain(`/portal/${eventSlug}/sign-in`);
    expect(fallback.rows[0]?.textSnapshot).not.toContain("token=");

    await page.getByRole("link", { name: "Continue to speaker portal" }).click();
    await expect(page).toHaveURL(new RegExp(`/portal/${eventSlug}/?$`));
    await expect(page).not.toHaveURL(/sign-in/);

    const persisted = await database.query(
      `SELECT p."sortOrder", v."email", v."givenName", v."biography", v."consentToPublishProfile"
       FROM "cfp_submission_participants" p
       JOIN "speakers" s ON s."id" = p."speakerId"
       JOIN "speaker_profile_versions" v ON v."speakerId" = s."id"
       WHERE p."eventId" = $1
       ORDER BY p."sortOrder", v."versionNumber" DESC`,
      [eventId],
    );
    expect(persisted.rows).toEqual([
      {
        sortOrder: 0,
        email: "alex@example.test",
        givenName: "Alex",
        biography: "Designs cooperative games.",
        consentToPublishProfile: true,
      },
      {
        sortOrder: 1,
        email: "sam@example.test",
        givenName: "Sam",
        biography: "Builds accessible party games.",
        consentToPublishProfile: true,
      },
    ]);

    await database.query(
      `UPDATE "cfp_policy_versions"
       SET "messages" = jsonb_set("messages", '{portalHandoff,autoRedirect}', 'false')
       WHERE "policyId" = $1`,
      [policyId],
    );
    await page.goto(`/cfp/${publicId}/start`);
    await waitForHydration(speakerField(0, "givenName"));
    await speakerField(0, "givenName").fill("Alex");
    await speakerField(0, "familyName").fill("Rivera");
    await speakerField(0, "email").fill("alex@example.test");
    await speakerField(0, "phone").fill("+1 555 0100");
    await speakerField(0, "biography").fill("Designs cooperative games.");
    await page.getByRole("checkbox", { name: "Speaker profile consent *" }).check();
    await page.getByLabel("Session title", { exact: false }).fill("Cooperative systems follow-up");
    await page.getByRole("button", { name: "Submit proposal" }).click();

    await expect(page.getByRole("heading", { name: "Proposal submitted" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue to speaker portal" })).toBeVisible();
    await expect(page.getByText(/Opening the speaker portal in \d+ seconds\./)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel automatic redirect" })).toHaveCount(0);
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" = $1`, [eventId]);
  }
});
