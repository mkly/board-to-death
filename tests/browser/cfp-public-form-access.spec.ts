import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { randomUUID } from "node:crypto";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: testDatabaseUrl });

// The public CFP route compiles on demand under the dev web server, which
// does not fit Playwright's 30s default (cfp-form-lifecycle.spec.ts raises it
// for the same reason).
test.setTimeout(120_000);

test.afterAll(async () => {
  await database.end();
});

test("serves distinct safe experiences for every public CFP access state via direct URLs", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const eventId = randomUUID();
  const eventSlug = `browser-cfp-public-${suffix}`;
  const formId = randomUUID();
  const genericVersionId = randomUUID();
  const restrictedVersionId = randomUUID();
  const openVersionId = randomUUID();
  const now = new Date();
  const timezone = "America/Los_Angeles";

  const publicIds = {
    unknown: randomUUID(),
    draft: randomUUID(),
    closed: randomUUID(),
    notYetOpen: randomUUID(),
    expired: randomUUID(),
    restricted: randomUUID(),
    open: randomUUID(),
  };

  // 2026-06-01T16:00:00Z is 9:00 AM PDT (daylight saving) and
  // 2026-12-01T08:00:00Z is midnight PST (standard time); both are in the
  // past/future relative to "now" but render through the America/Los_Angeles
  // conversion rather than a UTC passthrough, and span the DST boundary.
  const opensAt = new Date("2026-06-01T16:00:00.000Z");
  const closesAt = new Date("2026-12-01T08:00:00.000Z");
  const pastOpen = new Date("2019-12-01T00:00:00.000Z");
  const pastClose = new Date("2020-01-01T00:00:00.000Z");
  const futureOpen = new Date("2099-01-01T00:00:00.000Z");
  const futureClose = new Date("2099-06-01T00:00:00.000Z");

  const seedConnection = await database.connect();
  await seedConnection.query("BEGIN");
  try {
    await seedConnection.query(
      `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, $2, $3, 'CONFERENCE', $4, $5, $6, $7)`,
      [
        eventId,
        "Public CFP Event",
        eventSlug,
        timezone,
        new Date("2027-03-13T17:00:00.000Z"),
        new Date("2027-03-15T00:00:00.000Z"),
        now,
      ],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_forms" ("id", "eventId", "key", "updatedAt") VALUES ($1, $2, 'main-cfp', $3)`,
      [formId, eventId, now],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_form_versions"
       ("id", "formId", "versionNumber", "schemaVersion", "title", "customTypes")
       VALUES ($1, $2, 1, 1, 'Main CFP', '[]')`,
      [genericVersionId, formId],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_form_versions"
       ("id", "formId", "versionNumber", "schemaVersion", "title", "accessPolicy", "customTypes")
       VALUES ($1, $2, 2, 1, 'Main CFP', 'RESTRICTED', '[]')`,
      [restrictedVersionId, formId],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_form_versions"
       ("id", "formId", "versionNumber", "schemaVersion", "title", "accessPolicy",
        "welcomeTitle", "welcomeContent", "instructions", "termsContent", "consentRequired", "customTypes")
       VALUES ($1, $2, 3, 1, 'Main CFP', 'OPEN', 'Call for speakers', 'We would love to hear **your** talk idea.',
               'Prepare a short abstract before you start.', 'By submitting you agree to be recorded.', true, '[]')`,
      [openVersionId, formId],
    );

    await seedConnection.query(
      `INSERT INTO "cfp_policies" ("id", "eventId", "key", "publicId", "status", "updatedAt")
       VALUES ($1, $2, 'draft', $3, 'DRAFT', $4)`,
      [randomUUID(), eventId, publicIds.draft, now],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_policies" ("id", "eventId", "key", "publicId", "status", "publishedFormVersionId", "updatedAt")
       VALUES ($1, $2, 'closed', $3, 'CLOSED', $4, $5)`,
      [randomUUID(), eventId, publicIds.closed, genericVersionId, now],
    );

    const notYetOpenPolicyId = randomUUID();
    await seedConnection.query(
      `INSERT INTO "cfp_policies" ("id", "eventId", "key", "publicId", "status", "publishedFormVersionId", "updatedAt")
       VALUES ($1, $2, 'not-yet-open', $3, 'PUBLISHED', $4, $5)`,
      [notYetOpenPolicyId, eventId, publicIds.notYetOpen, genericVersionId, now],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_policy_versions"
       ("id", "eventId", "policyId", "versionNumber", "submissionOpensAt", "submissionClosesAt", "draftPolicy",
        "submissionLimits", "messages", "conditionalVisibility")
       VALUES ($1, $2, $3, 1, $4, $5, 'ALLOWED', $6, $7, '[]')`,
      [
        randomUUID(),
        eventId,
        notYetOpenPolicyId,
        futureOpen,
        futureClose,
        JSON.stringify({ maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 }),
        JSON.stringify({ introduction: "Welcome", submissionConfirmation: "Submitted", closed: "Closed" }),
      ],
    );

    const expiredPolicyId = randomUUID();
    await seedConnection.query(
      `INSERT INTO "cfp_policies" ("id", "eventId", "key", "publicId", "status", "publishedFormVersionId", "updatedAt")
       VALUES ($1, $2, 'expired', $3, 'PUBLISHED', $4, $5)`,
      [expiredPolicyId, eventId, publicIds.expired, genericVersionId, now],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_policy_versions"
       ("id", "eventId", "policyId", "versionNumber", "submissionOpensAt", "submissionClosesAt", "draftPolicy",
        "submissionLimits", "messages", "conditionalVisibility")
       VALUES ($1, $2, $3, 1, $4, $5, 'ALLOWED', $6, $7, '[]')`,
      [
        randomUUID(),
        eventId,
        expiredPolicyId,
        pastOpen,
        pastClose,
        JSON.stringify({ maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 }),
        JSON.stringify({ introduction: "Welcome", submissionConfirmation: "Submitted", closed: "Closed" }),
      ],
    );

    const restrictedPolicyId = randomUUID();
    await seedConnection.query(
      `INSERT INTO "cfp_policies" ("id", "eventId", "key", "publicId", "status", "publishedFormVersionId", "updatedAt")
       VALUES ($1, $2, 'restricted', $3, 'PUBLISHED', $4, $5)`,
      [restrictedPolicyId, eventId, publicIds.restricted, restrictedVersionId, now],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_policy_versions"
       ("id", "eventId", "policyId", "versionNumber", "submissionOpensAt", "submissionClosesAt", "draftPolicy",
        "submissionLimits", "messages", "conditionalVisibility")
       VALUES ($1, $2, $3, 1, $4, $5, 'ALLOWED', $6, $7, '[]')`,
      [
        randomUUID(),
        eventId,
        restrictedPolicyId,
        opensAt,
        closesAt,
        JSON.stringify({ maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 }),
        JSON.stringify({ introduction: "Welcome", submissionConfirmation: "Submitted", closed: "Closed" }),
      ],
    );

    const openPolicyId = randomUUID();
    await seedConnection.query(
      `INSERT INTO "cfp_policies" ("id", "eventId", "key", "publicId", "status", "publishedFormVersionId", "updatedAt")
       VALUES ($1, $2, 'open', $3, 'PUBLISHED', $4, $5)`,
      [openPolicyId, eventId, publicIds.open, openVersionId, now],
    );
    await seedConnection.query(
      `INSERT INTO "cfp_policy_versions"
       ("id", "eventId", "policyId", "versionNumber", "submissionOpensAt", "submissionClosesAt", "draftPolicy",
        "submissionLimits", "messages", "conditionalVisibility")
       VALUES ($1, $2, $3, 1, $4, $5, 'ALLOWED', $6, $7, '[]')`,
      [
        randomUUID(),
        eventId,
        openPolicyId,
        opensAt,
        closesAt,
        JSON.stringify({ maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 }),
        JSON.stringify({ introduction: "Welcome", submissionConfirmation: "Submitted", closed: "Closed" }),
      ],
    );

    await seedConnection.query("COMMIT");
  } catch (error) {
    await seedConnection.query("ROLLBACK");
    throw error;
  } finally {
    seedConnection.release();
  }

  try {
    await page.goto(`/cfp/${randomUUID()}`);
    await expect(page.getByRole("heading", { name: "Page not found." })).toBeVisible();

    await page.goto(`/cfp/${publicIds.draft}`);
    await expect(page.getByRole("heading", { name: "Page not found." })).toBeVisible();

    await page.goto(`/cfp/${publicIds.closed}`);
    await expect(page.getByRole("heading", { name: "Submissions closed" })).toBeVisible();
    await expect(page.getByText("Public CFP Event", { exact: false })).toBeVisible();

    await page.goto(`/cfp/${publicIds.notYetOpen}`);
    await expect(page.getByRole("heading", { name: "Not open yet" })).toBeVisible();

    await page.goto(`/cfp/${publicIds.expired}`);
    await expect(page.getByRole("heading", { name: "Submission window closed" })).toBeVisible();

    await page.goto(`/cfp/${publicIds.restricted}`);
    await expect(page.getByRole("heading", { name: "Private access required" })).toBeVisible();

    await page.goto(`/cfp/${publicIds.open}`);
    await expect(page.getByRole("heading", { name: "Call for speakers" })).toBeVisible();
    await expect(page.getByText("Public CFP Event")).toBeVisible();
    await expect(page.getByText("your talk idea", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Before you begin" })).toBeVisible();
    await expect(page.getByText("Prepare a short abstract before you start.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Terms and consent" })).toBeVisible();
    await expect(page.getByText("Applicants must agree before submitting.")).toBeVisible();

    const openFormatter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short",
    });
    await expect(page.getByText(`Opens: ${openFormatter.format(opensAt)}`)).toBeVisible();
    await expect(page.getByText(`Closes: ${openFormatter.format(closesAt)}`)).toBeVisible();

    const startLink = page.getByRole("link", { name: "Start your submission" });
    await expect(startLink).toBeVisible();
    await expect(startLink).toHaveAttribute("href", `/cfp/${publicIds.open}/start`);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(startLink).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(startLink).toBeVisible();
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" = $1`, [eventId]);
  }
});
