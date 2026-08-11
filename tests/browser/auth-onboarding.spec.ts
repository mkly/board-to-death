import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { magicLinkRequestUrl, signInAsAdmin, signUpOrganization } from "./fixtures/magic-link-webhook";
import { randomUUID } from "node:crypto";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

async function captureMagicLink(action: () => Promise<void>): Promise<string> {
  const requestUrl = magicLinkRequestUrl(randomUUID());
  const registration = await fetch(requestUrl, { method: "POST" });
  if (!registration.ok) throw new Error(`Could not register an onboarding delivery (${registration.status}).`);
  const deliveryPromise = fetch(requestUrl);
  deliveryPromise.catch(() => undefined);

  try {
    await action();
    const delivery = await deliveryPromise;
    if (!delivery.ok) throw new Error(`Could not receive the onboarding link (${delivery.status}).`);
    return ((await delivery.json()) as { url: string }).url;
  } catch (error) {
    await fetch(requestUrl, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

test.describe
  .serial("integrated authentication and invitation onboarding", () => {
    test.setTimeout(120_000);

    const suffix = randomUUID().slice(0, 8);
    const organizationId = randomUUID();
    const organizationName = `Onboarding Org ${suffix}`;
    const organizationSlug = `onboarding-org-${suffix}`;
    const eventId = randomUUID();
    const eventName = `Onboarding Event ${suffix}`;
    const eventSlug = `onboarding-event-${suffix}`;
    const unknownEmail = `unknown-${suffix}@example.test`;
    const signupEmail = `signup-${suffix}@example.test`;
    const signupOrganizationName = `Signup Org ${suffix}`;
    const organizationInviteEmail = `organization-invite-${suffix}@example.test`;
    const eventInviteEmail = `event-invite-${suffix}@example.test`;
    const createdEmails = [unknownEmail, signupEmail, organizationInviteEmail, eventInviteEmail];
    let database: Client;

    test.beforeAll(async () => {
      database = new Client({ connectionString: databaseUrl });
      await database.connect();
      const admin = await database.query<{ id: string }>(`SELECT "id" FROM "user" WHERE "email" = $1`, [
        "admin@example.test",
      ]);
      const adminId = admin.rows[0]?.id;
      if (!adminId) throw new Error("Expected global browser setup to provision the admin user.");

      await database.query(
        `INSERT INTO "organizations" ("id", "name", "slug", "updatedAt") VALUES ($1, $2, $3, NOW())`,
        [organizationId, organizationName, organizationSlug],
      );
      await database.query(
        `INSERT INTO "organization_members" ("id", "orgId", "userId", "role", "status", "updatedAt")
       VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', NOW())`,
        [randomUUID(), organizationId, adminId],
      );
      await database.query(
        `INSERT INTO "events" ("id", "orgId", "name", "slug", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'America/Los_Angeles', $5, $6, NOW())`,
        [
          eventId,
          organizationId,
          eventName,
          eventSlug,
          new Date("2027-10-10T16:00:00.000Z"),
          new Date("2027-10-12T00:00:00.000Z"),
        ],
      );
    });

    test.afterAll(async () => {
      await database.query(`DELETE FROM "events" WHERE "id" = $1`, [eventId]);
      await database.query(`DELETE FROM "organizations" WHERE "id" = $1 OR "name" = $2`, [
        organizationId,
        signupOrganizationName,
      ]);
      await database.query(`DELETE FROM "user" WHERE "email" = ANY($1)`, [createdEmails]);
      await database.end();
    });

    test("keeps an unknown login gated without creating a user or session", async ({ page }) => {
      await page.goto("/auth/v1/login");
      await page.getByRole("textbox", { name: "Email address" }).fill(unknownEmail);
      await page.getByRole("button", { name: "Email me a sign-in link" }).click();

      await expect(page.getByText("We couldn't find that account", { exact: false })).toBeVisible();
      await expect(page.getByRole("alert").getByRole("link", { name: "Create your organization" })).toBeVisible();
      const result = await database.query<{ users: number; sessions: number }>(
        `SELECT
         COUNT(DISTINCT "user"."id")::int AS "users",
         COUNT("session"."id")::int AS "sessions"
       FROM "user"
       LEFT JOIN "session" ON "session"."userId" = "user"."id"
       WHERE "user"."email" = $1`,
        [unknownEmail],
      );
      expect(result.rows[0]).toEqual({ users: 0, sessions: 0 });
    });

    test("registers a brand-new organization owner end to end", async ({ page }) => {
      await signUpOrganization(page, signupEmail, signupOrganizationName);

      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByText("No events yet", { exact: true })).toBeVisible();
      const organization = await database.query<{ name: string }>(
        `SELECT "name" FROM "organizations" WHERE "name" = $1`,
        [signupOrganizationName],
      );
      expect(organization.rows).toEqual([{ name: signupOrganizationName }]);
    });

    test("lets an owner invite a brand-new organization member who lands in that organization", async ({
      browser,
      page,
    }) => {
      await signInAsAdmin(page);
      await page.context().addCookies([{ name: "gatherpulse_active_org", value: organizationId, url: baseURL }]);
      await page.goto("/dashboard/organization");
      await expect(page.getByRole("heading", { name: "Organization team" })).toBeVisible();
      await page.getByLabel("Email").fill(organizationInviteEmail);
      await page.getByLabel("Role").selectOption("MEMBER");
      const invitationLink = await captureMagicLink(async () => {
        await page.getByRole("button", { name: "Send invitation" }).click();
      });
      await expect(page.getByText(`Invitation sent to ${organizationInviteEmail}.`)).toBeVisible();

      const inviteeContext = await browser.newContext();
      try {
        const inviteePage = await inviteeContext.newPage();
        await inviteePage.goto(invitationLink);
        await expect(inviteePage.getByText(`Join ${organizationName} as a member.`)).toBeVisible();
        await inviteePage.getByRole("button", { name: "Accept invitation" }).click();
        await expect(inviteePage).toHaveURL(/\/dashboard(?:\/events\/[^/]+\/overview)?$/);
        await expect(inviteePage.getByText(organizationName, { exact: true })).toBeVisible();
        await expect(inviteePage.getByRole("combobox", { name: "Active event" })).toContainText(eventName);
      } finally {
        await inviteeContext.close();
      }

      const membership = await database.query<{ role: string; status: string }>(
        `SELECT "organization_members"."role", "organization_members"."status"
       FROM "organization_members"
       JOIN "user" ON "user"."id" = "organization_members"."userId"
       WHERE "organization_members"."orgId" = $1 AND "user"."email" = $2`,
        [organizationId, organizationInviteEmail],
      );
      expect(membership.rows).toEqual([{ role: "MEMBER", status: "ACTIVE" }]);
    });

    test("accepts a brand-new event invite without granting organization membership", async ({ browser, page }) => {
      await signInAsAdmin(page);
      await page.context().addCookies([{ name: "gatherpulse_active_org", value: organizationId, url: baseURL }]);
      await page.goto(`/dashboard/events/${eventSlug}/settings/team`);
      await page.getByLabel("Email").fill(eventInviteEmail);
      await page.getByLabel("Display name").fill("Event Invitee");
      await page.getByLabel("Role").selectOption("REVIEWER");
      const invitationLink = await captureMagicLink(async () => {
        await page.getByRole("button", { name: "Send invitation" }).click();
      });

      const inviteeContext = await browser.newContext();
      try {
        const inviteePage = await inviteeContext.newPage();
        await inviteePage.goto(invitationLink);
        await expect(inviteePage.getByText(`Join ${eventName} as a reviewer.`)).toBeVisible();
        await inviteePage.getByRole("button", { name: "Accept invitation" }).click();
        await expect(inviteePage.getByRole("heading", { name: "Your assigned reviews" })).toBeVisible();
      } finally {
        await inviteeContext.close();
      }

      const access = await database.query<{ eventMemberships: number; organizationMemberships: number }>(
        `SELECT
         (SELECT COUNT(*)::int
          FROM "event_memberships"
          JOIN "user" ON "user"."id" = "event_memberships"."userId"
          WHERE "event_memberships"."eventId" = $1 AND "user"."email" = $2) AS "eventMemberships",
         (SELECT COUNT(*)::int
          FROM "organization_members"
          JOIN "user" ON "user"."id" = "organization_members"."userId"
          WHERE "organization_members"."orgId" = $3 AND "user"."email" = $2) AS "organizationMemberships"`,
        [eventId, eventInviteEmail, organizationId],
      );
      expect(access.rows[0]).toEqual({ eventMemberships: 1, organizationMemberships: 0 });
    });
  });
