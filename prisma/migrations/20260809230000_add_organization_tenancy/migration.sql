CREATE TYPE "OrganizationMemberRole" AS ENUM ('OWNER', 'MEMBER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "EventMembershipRole" AS ENUM ('organizer-admin', 'reviewer', 'applicant', 'speaker');

CREATE TABLE "organizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organizations_name" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "organizations_slug" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

INSERT INTO "organizations" ("id", "name", "slug", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000100', 'Legacy organization', 'legacy-organization', CURRENT_TIMESTAMP);

ALTER TABLE "events"
ADD COLUMN "orgId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000100';

ALTER TABLE "people"
ADD COLUMN "orgId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000100';

CREATE TABLE "organization_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "OrganizationMemberRole" NOT NULL DEFAULT 'MEMBER',
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_members_status" CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  )
);

CREATE TABLE "event_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "roles" "EventMembershipRole"[] NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "event_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_memberships_roles" CHECK (cardinality("roles") > 0),
  CONSTRAINT "event_memberships_status" CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  )
);

DROP INDEX "people_email_key";

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX "organization_members_orgId_userId_key" ON "organization_members"("orgId", "userId");
CREATE INDEX "organization_members_userId_status_idx" ON "organization_members"("userId", "status");
CREATE UNIQUE INDEX "event_memberships_eventId_userId_key" ON "event_memberships"("eventId", "userId");
CREATE INDEX "event_memberships_userId_status_idx" ON "event_memberships"("userId", "status");
CREATE INDEX "events_orgId_archivedAt_startsAt_idx" ON "events"("orgId", "archivedAt", "startsAt");
CREATE UNIQUE INDEX "people_orgId_email_key" ON "people"("orgId", "email");

ALTER TABLE "events"
ADD CONSTRAINT "events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "people"
ADD CONSTRAINT "people_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_members"
ADD CONSTRAINT "organization_members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_members"
ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_memberships"
ADD CONSTRAINT "event_memberships_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_memberships"
ADD CONSTRAINT "event_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reviewers historically carried an opaque identity ID. Preserve an existing Better Auth
-- identity when one exists; otherwise create a compatible user keyed by that identity.
WITH reviewer_users AS (
  SELECT DISTINCT ON (lower(btrim("email")))
    "identityId" AS "id",
    "displayName" AS "name",
    lower(btrim("email")) AS "email",
    "createdAt",
    "updatedAt"
  FROM "evaluation_reviewers"
  WHERE length(btrim("identityId")) > 0
    AND length(btrim("email")) > 0
  ORDER BY lower(btrim("email")), "createdAt", "id"
)
INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
SELECT
  reviewer_users."id",
  reviewer_users."name",
  reviewer_users."email",
  false,
  reviewer_users."createdAt",
  reviewer_users."updatedAt"
FROM reviewer_users
WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = reviewer_users."id")
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE lower("user"."email") = reviewer_users."email")
ON CONFLICT DO NOTHING;

-- CFP administrator IDs were email-keyed. Materialize a Better Auth identity for every
-- unmapped address so memberships use the same user.id key as runtime sessions.
WITH administrator_users AS (
  SELECT DISTINCT ON (lower(btrim("externalId")))
    'legacy-cfp-admin-' || md5(lower(btrim("externalId"))) AS "id",
    "displayName" AS "name",
    lower(btrim("externalId")) AS "email",
    "createdAt",
    "updatedAt"
  FROM "cfp_administrators"
  WHERE length(btrim("externalId")) > 0
  ORDER BY lower(btrim("externalId")), "createdAt", "id"
)
INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
SELECT
  administrator_users."id",
  administrator_users."name",
  administrator_users."email",
  false,
  administrator_users."createdAt",
  administrator_users."updatedAt"
FROM administrator_users
WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = administrator_users."email")
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE lower("user"."email") = administrator_users."email")
ON CONFLICT DO NOTHING;

-- Every pre-tenancy user belongs to the legacy organization. Org roles are deliberately
-- flat today; OWNER preserves existing administrative access until role enforcement lands.
INSERT INTO "organization_members" ("orgId", "userId", "role", "status", "updatedAt")
SELECT
  '00000000-0000-4000-8000-000000000100',
  "id",
  'OWNER',
  'ACTIVE',
  CURRENT_TIMESTAMP
FROM "user"
ON CONFLICT ("orgId", "userId") DO NOTHING;

INSERT INTO "event_memberships" ("eventId", "userId", "roles", "status", "revokedAt", "createdAt", "updatedAt")
SELECT
  reviewer."eventId",
  COALESCE(identity_user."id", email_user."id"),
  ARRAY['reviewer']::"EventMembershipRole"[],
  CASE WHEN reviewer."status" = 'ACTIVE' THEN 'ACTIVE' ELSE 'REVOKED' END::"MembershipStatus",
  CASE WHEN reviewer."status" = 'ACTIVE' THEN NULL ELSE reviewer."updatedAt" END,
  reviewer."createdAt",
  reviewer."updatedAt"
FROM "evaluation_reviewers" reviewer
LEFT JOIN "user" identity_user ON identity_user."id" = reviewer."identityId"
LEFT JOIN "user" email_user ON lower(email_user."email") = lower(btrim(reviewer."email"))
WHERE COALESCE(identity_user."id", email_user."id") IS NOT NULL
ON CONFLICT ("eventId", "userId") DO UPDATE SET
  "roles" = CASE
    WHEN "event_memberships"."roles" @> EXCLUDED."roles" THEN "event_memberships"."roles"
    ELSE "event_memberships"."roles" || EXCLUDED."roles"
  END,
  "status" = CASE
    WHEN "event_memberships"."status" = 'ACTIVE' OR EXCLUDED."status" = 'ACTIVE'
      THEN 'ACTIVE'::"MembershipStatus"
    ELSE 'REVOKED'::"MembershipStatus"
  END,
  "revokedAt" = CASE
    WHEN "event_memberships"."status" = 'ACTIVE' OR EXCLUDED."status" = 'ACTIVE' THEN NULL
    ELSE COALESCE("event_memberships"."revokedAt", EXCLUDED."revokedAt")
  END,
  "updatedAt" = GREATEST("event_memberships"."updatedAt", EXCLUDED."updatedAt");

INSERT INTO "event_memberships" ("eventId", "userId", "roles", "status", "createdAt", "updatedAt")
SELECT
  administrator."eventId",
  COALESCE(identity_user."id", email_user."id"),
  ARRAY['organizer-admin']::"EventMembershipRole"[],
  'ACTIVE',
  administrator."createdAt",
  administrator."updatedAt"
FROM "cfp_administrators" administrator
LEFT JOIN "user" identity_user ON identity_user."id" = administrator."externalId"
LEFT JOIN "user" email_user ON lower(email_user."email") = lower(btrim(administrator."externalId"))
WHERE COALESCE(identity_user."id", email_user."id") IS NOT NULL
ON CONFLICT ("eventId", "userId") DO UPDATE SET
  "roles" = CASE
    WHEN "event_memberships"."roles" @> EXCLUDED."roles" THEN "event_memberships"."roles"
    ELSE "event_memberships"."roles" || EXCLUDED."roles"
  END,
  "status" = 'ACTIVE'::"MembershipStatus",
  "revokedAt" = NULL,
  "updatedAt" = GREATEST("event_memberships"."updatedAt", EXCLUDED."updatedAt");
