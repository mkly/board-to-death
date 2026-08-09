import { type BrowserContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

import { waitForHydration } from "./helpers/hydration";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: databaseUrl });

test.setTimeout(120_000);

test.afterAll(async () => {
  await database.end();
});

async function prepareGroupIntake(context: BrowserContext) {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/group-intake.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as { eventId: string; eventSlug: string; sessionCookie: string };
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL }]);
  return fixture;
}

async function submitInterest(
  page: import("@playwright/test").Page,
  href: string,
  contact: { readonly givenName: string; readonly familyName: string; readonly email: string },
) {
  await page.goto(href);
  await page.getByLabel("Organization name").fill("Analytical Engines");
  await page.getByLabel("First name").fill(contact.givenName);
  await page.getByLabel("Last name").fill(contact.familyName);
  await page.getByLabel("Email").fill(contact.email);
  const submit = page.getByRole("button", { name: "Submit for review" });
  await waitForHydration(submit);
  await submit.click();
  await expect(page.getByRole("heading", { name: "Thanks for your interest" })).toBeVisible();
}

test("publishes partner forms and reviews duplicate-safe event-scoped submissions", async ({ context, page }) => {
  const fixture = await prepareGroupIntake(context);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/groups`);
  await expect(page.getByRole("heading", { name: "Partner intake" })).toBeVisible();
  await expect(page.getByText("Foreign Organization")).toHaveCount(0);

  const sponsorCard = page.locator('[data-slot="card"]').filter({ hasText: "Sponsor interest form" }).first();
  await sponsorCard.getByRole("button", { name: "Publish form" }).click();
  await expect(page.getByText("Sponsor intake form published.")).toBeVisible();
  const sponsorHref = await sponsorCard.getByRole("link", { name: "Open public form" }).getAttribute("href");
  expect(sponsorHref).toBeTruthy();

  const exhibitorCard = page.locator('[data-slot="card"]').filter({ hasText: "Exhibitor interest form" }).first();
  await exhibitorCard.getByRole("button", { name: "Publish form" }).click();
  await expect(page.getByText("Exhibitor intake form published.")).toBeVisible();
  await expect(exhibitorCard.getByRole("link", { name: "Open public form" })).toBeVisible();

  await page.goto(sponsorHref ?? "");
  await page.getByLabel("Organization name").fill("Analytical Engines");
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Lovelace");
  await page.getByLabel("Email").fill("not-an-email");
  const invalidSubmit = page.getByRole("button", { name: "Submit for review" });
  await waitForHydration(invalidSubmit);
  await invalidSubmit.click();
  await expect(page.getByText("Review the form and fix the highlighted fields.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");

  await submitInterest(page, sponsorHref ?? "", {
    givenName: "Ada",
    familyName: "Lovelace",
    email: "ada@example.test",
  });
  await page.goto(`/dashboard/events/${fixture.eventSlug}/groups`);
  const firstSubmission = page.getByRole("row", { name: /Analytical Engines.*Ada Lovelace/ });
  await expect(firstSubmission).toBeVisible();
  await firstSubmission.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Intake submission accepted.")).toBeVisible();
  await expect(page.locator('input[value="Analytical Engines"]')).toBeVisible();

  await submitInterest(page, sponsorHref ?? "", {
    givenName: "Grace",
    familyName: "Hopper",
    email: "grace@example.test",
  });
  await page.goto(`/dashboard/events/${fixture.eventSlug}/groups`);
  const secondSubmission = page.getByRole("row", { name: /Analytical Engines.*Grace Hopper/ });
  await secondSubmission.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Intake submission accepted.")).toBeVisible();

  const result = await database.query<{ groupCount: string; primaryEmail: string }>(
    `SELECT COUNT(DISTINCT g."id")::text AS "groupCount", MAX(c."email") AS "primaryEmail"
     FROM "contact_groups" g
     JOIN "contacts" c ON c."eventId" = g."eventId" AND c."id" = g."primaryContactId"
     WHERE g."eventId" = $1 AND g."slug" = 'analytical-engines'`,
    [fixture.eventId],
  );
  expect(result.rows[0]).toEqual({ groupCount: "1", primaryEmail: "grace@example.test" });

  const refreshedSponsorCard = page.locator('[data-slot="card"]').filter({ hasText: "Sponsor interest form" }).first();
  await refreshedSponsorCard.getByRole("button", { name: "Close form" }).click();
  await expect(page.getByText("Sponsor intake form closed.")).toBeVisible();
  await page.goto(sponsorHref ?? "");
  await expect(page.getByRole("heading", { name: "Partner intake closed" })).toBeVisible();
});
