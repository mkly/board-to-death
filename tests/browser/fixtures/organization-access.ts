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
 */
export async function grantSeededOrganizationAccess(email: string): Promise<void> {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    await database.query(
      `INSERT INTO "organization_members" ("id", "orgId", "userId", "role", "status", "updatedAt")
       SELECT gen_random_uuid(), organizations."id", "user"."id", 'OWNER', 'ACTIVE', NOW()
       FROM "user"
       CROSS JOIN "organizations"
       WHERE "user"."email" = $1
       ON CONFLICT ("orgId", "userId") DO NOTHING`,
      [email],
    );
  } finally {
    await database.end();
  }
}
