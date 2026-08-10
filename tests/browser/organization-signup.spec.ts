import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { signUpOrganization } from "./fixtures/magic-link-webhook";
import { randomUUID } from "node:crypto";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

test("signup provisions organizations and keeps each active organization event-scoped", async ({ browser }) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  const suffix = randomUUID().slice(0, 8);
  const email = `owner-${suffix}@example.test`;
  const firstName = `First Org ${suffix}`;
  const secondName = `Second Org ${suffix}`;
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();

  try {
    const firstPage = await firstContext.newPage();
    await signUpOrganization(firstPage, email, firstName);
    await expect(firstPage).toHaveURL(/\/dashboard$/);
    await expect(firstPage.getByText("No events yet", { exact: true })).toBeVisible();
    await expect(firstPage.getByRole("link", { name: "Create your first event" })).toHaveAttribute(
      "href",
      "/dashboard/event-settings",
    );

    const firstOrganization = await database.query<{ id: string }>(
      `SELECT "id" FROM "organizations" WHERE "name" = $1 LIMIT 1`,
      [firstName],
    );
    const firstOrganizationId = firstOrganization.rows[0]?.id;
    if (!firstOrganizationId) throw new Error("Expected the first signup organization");
    const firstEvent = { id: randomUUID(), name: `First Event ${suffix}`, slug: `first-event-${suffix}` };
    await database.query(
      `INSERT INTO "events" ("id", "orgId", "name", "slug", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'America/Los_Angeles', $5, $6, NOW())`,
      [
        firstEvent.id,
        firstOrganizationId,
        firstEvent.name,
        firstEvent.slug,
        new Date("2027-05-10T16:00:00.000Z"),
        new Date("2027-05-12T00:00:00.000Z"),
      ],
    );

    const secondPage = await secondContext.newPage();
    await signUpOrganization(secondPage, email, secondName);
    await expect(secondPage).toHaveURL(/\/dashboard$/);
    const secondOrganization = await database.query<{ id: string }>(
      `SELECT "id" FROM "organizations" WHERE "name" = $1 LIMIT 1`,
      [secondName],
    );
    const secondOrganizationId = secondOrganization.rows[0]?.id;
    if (!secondOrganizationId) throw new Error("Expected the second signup organization");
    const secondEvent = { id: randomUUID(), name: `Second Event ${suffix}`, slug: `second-event-${suffix}` };
    await database.query(
      `INSERT INTO "events" ("id", "orgId", "name", "slug", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'America/New_York', $5, $6, NOW())`,
      [
        secondEvent.id,
        secondOrganizationId,
        secondEvent.name,
        secondEvent.slug,
        new Date("2027-06-10T16:00:00.000Z"),
        new Date("2027-06-12T00:00:00.000Z"),
      ],
    );

    await secondPage.goto("/dashboard");
    await expect(secondPage).toHaveURL(new RegExp(`/dashboard/events/${secondEvent.slug}`));
    await expect(secondPage.getByRole("combobox", { name: "Active event" })).toContainText(secondEvent.name);
    await expect(secondPage.getByRole("combobox", { name: "Active event" })).not.toContainText(firstEvent.name);

    const unauthorized = await secondPage.goto(`/dashboard/events/${firstEvent.slug}/overview`);
    expect(unauthorized?.status()).toBe(404);
    await expect(secondPage.getByText(firstEvent.name)).toHaveCount(0);

    await secondPage.goto("/dashboard");
    await secondPage.getByRole("combobox", { name: "Active organization" }).click();
    await secondPage.getByRole("option", { name: firstName }).click();
    await expect(secondPage).toHaveURL(new RegExp(`/dashboard/events/${firstEvent.slug}`));
    await expect(secondPage.getByRole("combobox", { name: "Active event" })).toContainText(firstEvent.name);
    await expect(secondPage.getByRole("combobox", { name: "Active event" })).not.toContainText(secondEvent.name);
  } finally {
    await firstContext.close();
    await secondContext.close();
    await database.query(
      `DELETE FROM "events" WHERE "orgId" IN (SELECT "id" FROM "organizations" WHERE "name" = ANY($1))`,
      [[firstName, secondName]],
    );
    await database.query(`DELETE FROM "organizations" WHERE "name" = ANY($1)`, [[firstName, secondName]]);
    await database.query(`DELETE FROM "session" WHERE "userId" IN (SELECT "id" FROM "user" WHERE "email" = $1)`, [
      email,
    ]);
    await database.query(`DELETE FROM "user" WHERE "email" = $1`, [email]);
    await database.end();
  }
});
