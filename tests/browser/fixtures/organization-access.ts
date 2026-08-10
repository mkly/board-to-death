import { Client } from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

/**
 * Gives a browser-suite account an active OWNER membership in every seeded organization.
 *
 * Organizer access is derived from `organization_members`: an account with no row there
 * sees no events, so every `/dashboard/events/<slug>/<workspace>` route answers 404. The
 * application only creates that row through the organization registration flow — a plain
 * magic-link sign-in deliberately creates no organization — so a fixture that seeds events
 * directly and then mints a session has to grant the membership registration would have.
 *
 * Seeded events belong to the legacy organization unless a fixture says otherwise, and a
 * fixture's admin is meant to organize everything it seeded, so this grants membership in
 * every organization rather than a hard-coded one.
 *
 * Which of those organizations becomes the *active* one decides which events the dashboard
 * shell shows: `resolveMembershipPrincipal` orders memberships by `createdAt` then `orgId`,
 * and `getRequestAuthorization` falls back to the first one. Granting every membership in a
 * single statement gives them all the same `NOW()`, so the tie fell to the lowest `orgId` —
 * and a leftover representative organization from an earlier spec (…000000000050) sorts ahead
 * of the seeded legacy organization (…000000000100), silently hiding every legacy-org event
 * behind a 404. The legacy membership is therefore backdated so it always wins the fallback;
 * a fixture that wants its own organization active sets the `board_to_death_active_org` cookie.
 */
const legacyOrganizationId = "00000000-0000-4000-8000-000000000100";
export async function grantSeededOrganizationAccess(email: string): Promise<void> {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    await database.query(
      `INSERT INTO "organization_members" ("id", "orgId", "userId", "role", "status", "createdAt", "updatedAt")
       SELECT
         gen_random_uuid(),
         organizations."id",
         "user"."id",
         'OWNER',
         'ACTIVE',
         CASE WHEN organizations."id" = $2::uuid THEN TIMESTAMPTZ '1970-01-01T00:00:00Z' ELSE NOW() END,
         NOW()
       FROM "user"
       CROSS JOIN "organizations"
       WHERE "user"."email" = $1
       ON CONFLICT ("orgId", "userId") DO UPDATE
         SET "role" = 'OWNER',
             "status" = 'ACTIVE',
             "revokedAt" = NULL,
             "createdAt" = EXCLUDED."createdAt",
             "updatedAt" = NOW()`,
      [email, legacyOrganizationId],
    );
  } finally {
    await database.end();
  }
}
