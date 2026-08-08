CREATE TYPE "CfpPolicyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');
CREATE TYPE "CfpDraftPolicy" AS ENUM ('DISABLED', 'ALLOWED', 'REQUIRED');
CREATE TYPE "CfpAdminRole" AS ENUM ('OWNER', 'EDITOR', 'REVIEWER');

CREATE TABLE "cfp_administrators" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cfp_administrators_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_administrators_external_id" CHECK (length(btrim("externalId")) > 0),
    CONSTRAINT "cfp_administrators_display_name" CHECK (length(btrim("displayName")) > 0)
);

CREATE TABLE "cfp_policies" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "status" "CfpPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cfp_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_policies_key" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE "cfp_policy_versions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "submissionOpensAt" TIMESTAMPTZ(3) NOT NULL,
    "submissionClosesAt" TIMESTAMPTZ(3) NOT NULL,
    "confirmationClosesAt" TIMESTAMPTZ(3),
    "draftPolicy" "CfpDraftPolicy" NOT NULL,
    "submissionLimits" JSONB NOT NULL,
    "messages" JSONB NOT NULL,
    "conditionalVisibility" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cfp_policy_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_policy_versions_positive_version" CHECK ("versionNumber" > 0),
    CONSTRAINT "cfp_policy_versions_deadlines" CHECK (
        "submissionOpensAt" < "submissionClosesAt"
        AND ("confirmationClosesAt" IS NULL OR "confirmationClosesAt" >= "submissionClosesAt")
    )
);

CREATE TABLE "cfp_policy_category_routes" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "condition" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "cfp_policy_category_routes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_policy_category_routes_nonnegative_order" CHECK ("sortOrder" >= 0)
);

CREATE TABLE "cfp_policy_admin_assignments" (
    "eventId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "administratorId" UUID NOT NULL,
    "role" "CfpAdminRole" NOT NULL,
    CONSTRAINT "cfp_policy_admin_assignments_pkey" PRIMARY KEY ("versionId", "administratorId")
);

CREATE TABLE "cfp_policy_transitions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "fromStatus" "CfpPolicyStatus",
    "toStatus" "CfpPolicyStatus" NOT NULL,
    "actorAdministratorId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cfp_policy_transitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_policy_transitions_allowed" CHECK (
        ("fromStatus" IS NULL AND "toStatus" = 'DRAFT')
        OR ("fromStatus" = 'DRAFT' AND "toStatus" = 'PUBLISHED')
        OR ("fromStatus" = 'PUBLISHED' AND "toStatus" = 'CLOSED')
        OR ("fromStatus" = 'CLOSED' AND "toStatus" = 'ARCHIVED')
    )
);

CREATE INDEX "cfp_administrators_eventId_idx" ON "cfp_administrators"("eventId");
CREATE UNIQUE INDEX "cfp_administrators_eventId_externalId_key" ON "cfp_administrators"("eventId", "externalId");
CREATE UNIQUE INDEX "cfp_administrators_eventId_id_key" ON "cfp_administrators"("eventId", "id");
CREATE INDEX "cfp_policies_eventId_status_idx" ON "cfp_policies"("eventId", "status");
CREATE UNIQUE INDEX "cfp_policies_eventId_key_key" ON "cfp_policies"("eventId", "key");
CREATE UNIQUE INDEX "cfp_policies_eventId_id_key" ON "cfp_policies"("eventId", "id");
CREATE UNIQUE INDEX "cfp_policies_publicId_key" ON "cfp_policies"("publicId");
CREATE INDEX "cfp_policy_versions_eventId_policyId_idx" ON "cfp_policy_versions"("eventId", "policyId");
CREATE UNIQUE INDEX "cfp_policy_versions_policyId_versionNumber_key" ON "cfp_policy_versions"("policyId", "versionNumber");
CREATE UNIQUE INDEX "cfp_policy_versions_eventId_id_key" ON "cfp_policy_versions"("eventId", "id");
CREATE UNIQUE INDEX "cfp_policy_category_routes_versionId_sortOrder_key" ON "cfp_policy_category_routes"("versionId", "sortOrder");
CREATE INDEX "cfp_policy_category_routes_eventId_categoryId_idx" ON "cfp_policy_category_routes"("eventId", "categoryId");
CREATE INDEX "cfp_policy_admin_assignments_eventId_administratorId_idx" ON "cfp_policy_admin_assignments"("eventId", "administratorId");
CREATE INDEX "cfp_policy_transitions_policyId_occurredAt_idx" ON "cfp_policy_transitions"("policyId", "occurredAt");
CREATE INDEX "cfp_policy_transitions_eventId_actorAdministratorId_idx" ON "cfp_policy_transitions"("eventId", "actorAdministratorId");

ALTER TABLE "cfp_administrators"
ADD CONSTRAINT "cfp_administrators_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_policies"
ADD CONSTRAINT "cfp_policies_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_policy_versions"
ADD CONSTRAINT "cfp_policy_versions_eventId_policyId_fkey" FOREIGN KEY ("eventId", "policyId") REFERENCES "cfp_policies"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_policy_category_routes"
ADD CONSTRAINT "cfp_policy_category_routes_eventId_versionId_fkey" FOREIGN KEY ("eventId", "versionId") REFERENCES "cfp_policy_versions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_policy_category_routes"
ADD CONSTRAINT "cfp_policy_category_routes_eventId_categoryId_fkey" FOREIGN KEY ("eventId", "categoryId") REFERENCES "cfp_categories"("eventId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "cfp_policy_admin_assignments"
ADD CONSTRAINT "cfp_policy_admin_assignments_eventId_versionId_fkey" FOREIGN KEY ("eventId", "versionId") REFERENCES "cfp_policy_versions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_policy_admin_assignments"
ADD CONSTRAINT "cfp_policy_admin_assignments_eventId_administratorId_fkey" FOREIGN KEY ("eventId", "administratorId") REFERENCES "cfp_administrators"("eventId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "cfp_policy_transitions"
ADD CONSTRAINT "cfp_policy_transitions_eventId_policyId_fkey" FOREIGN KEY ("eventId", "policyId") REFERENCES "cfp_policies"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_policy_transitions"
ADD CONSTRAINT "cfp_policy_transitions_eventId_actorAdministratorId_fkey" FOREIGN KEY ("eventId", "actorAdministratorId") REFERENCES "cfp_administrators"("eventId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION prevent_cfp_policy_public_id_update() RETURNS trigger AS $$
BEGIN
    IF NEW."publicId" <> OLD."publicId" THEN
        RAISE EXCEPTION 'CFP policy public identifiers are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cfp_policies_immutable_public_id"
BEFORE UPDATE OF "publicId" ON "cfp_policies"
FOR EACH ROW EXECUTE FUNCTION prevent_cfp_policy_public_id_update();
