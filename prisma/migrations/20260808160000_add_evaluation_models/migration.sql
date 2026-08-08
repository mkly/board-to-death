CREATE TYPE "EvaluationPlanVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "EvaluationRoundStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED');
CREATE TYPE "EvaluationReviewerStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "EvaluationAssignmentStatus" AS ENUM ('ASSIGNED', 'COMPLETED', 'REVOKED');
CREATE TYPE "EvaluationStatus" AS ENUM ('DRAFT', 'FINAL');
CREATE TYPE "EvaluationDecisionOutcome" AS ENUM ('WAITLISTED', 'ACCEPTED', 'REJECTED');

CREATE TABLE "evaluation_plans" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_plans_key" CHECK (length(btrim("key")) > 0)
);

CREATE TABLE "evaluation_plan_versions" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "EvaluationPlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "activatedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_plan_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_plan_versions_positive_version" CHECK ("versionNumber" > 0),
    CONSTRAINT "evaluation_plan_versions_title" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "evaluation_plan_versions_status_timestamps" CHECK (
        ("status" = 'DRAFT' AND "activatedAt" IS NULL AND "retiredAt" IS NULL)
        OR ("status" = 'ACTIVE' AND "activatedAt" IS NOT NULL AND "retiredAt" IS NULL)
        OR ("status" = 'RETIRED' AND "activatedAt" IS NOT NULL AND "retiredAt" IS NOT NULL)
    )
);

CREATE TABLE "evaluation_rounds" (
    "id" UUID NOT NULL,
    "planVersionId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "status" "EvaluationRoundStatus" NOT NULL DEFAULT 'PLANNED',
    "opensAt" TIMESTAMPTZ(3),
    "closesAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_rounds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_rounds_key" CHECK (length(btrim("key")) > 0),
    CONSTRAINT "evaluation_rounds_title" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "evaluation_rounds_nonnegative_order" CHECK ("sortOrder" >= 0),
    CONSTRAINT "evaluation_rounds_time_order" CHECK ("closesAt" IS NULL OR "opensAt" IS NULL OR "closesAt" > "opensAt")
);

CREATE TABLE "evaluation_criteria" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "weight" DECIMAL(8,4) NOT NULL DEFAULT 1,
    "minimum" DECIMAL(8,4) NOT NULL,
    "maximum" DECIMAL(8,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_criteria_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_criteria_key" CHECK (length(btrim("key")) > 0),
    CONSTRAINT "evaluation_criteria_label" CHECK (length(btrim("label")) > 0),
    CONSTRAINT "evaluation_criteria_nonnegative_order" CHECK ("sortOrder" >= 0),
    CONSTRAINT "evaluation_criteria_positive_weight" CHECK ("weight" > 0),
    CONSTRAINT "evaluation_criteria_score_range" CHECK ("maximum" > "minimum")
);

CREATE TABLE "evaluation_reviewers" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "identityId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "EvaluationReviewerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_reviewers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_reviewers_identity" CHECK (length(btrim("identityId")) > 0),
    CONSTRAINT "evaluation_reviewers_email" CHECK (length(btrim("email")) > 0),
    CONSTRAINT "evaluation_reviewers_display_name" CHECK (length(btrim("displayName")) > 0)
);

CREATE TABLE "evaluation_committees" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_committees_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_committees_key" CHECK (length(btrim("key")) > 0),
    CONSTRAINT "evaluation_committees_name" CHECK (length(btrim("name")) > 0)
);

CREATE TABLE "evaluation_committee_members" (
    "committeeId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evaluation_committee_members_pkey" PRIMARY KEY ("committeeId", "reviewerId")
);

CREATE TABLE "evaluation_assignments" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "committeeId" UUID,
    "status" "EvaluationAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_assignments_status_timestamps" CHECK (
        ("status" = 'ASSIGNED' AND "completedAt" IS NULL AND "revokedAt" IS NULL)
        OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "revokedAt" IS NULL)
        OR ("status" = 'REVOKED' AND "completedAt" IS NULL AND "revokedAt" IS NOT NULL)
    )
);

CREATE TABLE "evaluations" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "overallNote" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluations_status_timestamp" CHECK (
        ("status" = 'DRAFT' AND "submittedAt" IS NULL)
        OR ("status" = 'FINAL' AND "submittedAt" IS NOT NULL)
    )
);

CREATE TABLE "evaluation_results" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "criterionId" UUID NOT NULL,
    "score" DECIMAL(8,4) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evaluation_decisions" (
    "id" UUID NOT NULL,
    "planVersionId" UUID NOT NULL,
    "roundId" UUID,
    "submissionId" UUID NOT NULL,
    "decisionNumber" INTEGER NOT NULL,
    "outcome" "EvaluationDecisionOutcome" NOT NULL,
    "supersedesDecisionId" UUID,
    "decidedBy" TEXT NOT NULL,
    "rationale" TEXT,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evaluation_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_decisions_positive_number" CHECK ("decisionNumber" > 0),
    CONSTRAINT "evaluation_decisions_actor" CHECK (length(btrim("decidedBy")) > 0),
    CONSTRAINT "evaluation_decisions_not_self_superseding" CHECK ("supersedesDecisionId" IS NULL OR "supersedesDecisionId" <> "id")
);

CREATE INDEX "evaluation_plans_eventId_idx" ON "evaluation_plans"("eventId");
CREATE UNIQUE INDEX "evaluation_plans_eventId_key_key" ON "evaluation_plans"("eventId", "key");
CREATE INDEX "evaluation_plan_versions_planId_status_idx" ON "evaluation_plan_versions"("planId", "status");
CREATE UNIQUE INDEX "evaluation_plan_versions_planId_versionNumber_key" ON "evaluation_plan_versions"("planId", "versionNumber");
CREATE UNIQUE INDEX "evaluation_plan_versions_one_active" ON "evaluation_plan_versions"("planId") WHERE "status" = 'ACTIVE';
CREATE INDEX "evaluation_rounds_planVersionId_status_idx" ON "evaluation_rounds"("planVersionId", "status");
CREATE UNIQUE INDEX "evaluation_rounds_planVersionId_key_key" ON "evaluation_rounds"("planVersionId", "key");
CREATE UNIQUE INDEX "evaluation_rounds_planVersionId_sortOrder_key" ON "evaluation_rounds"("planVersionId", "sortOrder");
CREATE INDEX "evaluation_criteria_roundId_idx" ON "evaluation_criteria"("roundId");
CREATE UNIQUE INDEX "evaluation_criteria_roundId_key_key" ON "evaluation_criteria"("roundId", "key");
CREATE UNIQUE INDEX "evaluation_criteria_roundId_sortOrder_key" ON "evaluation_criteria"("roundId", "sortOrder");
CREATE INDEX "evaluation_reviewers_eventId_status_idx" ON "evaluation_reviewers"("eventId", "status");
CREATE UNIQUE INDEX "evaluation_reviewers_eventId_identityId_key" ON "evaluation_reviewers"("eventId", "identityId");
CREATE UNIQUE INDEX "evaluation_reviewers_eventId_email_key" ON "evaluation_reviewers"("eventId", "email");
CREATE INDEX "evaluation_committees_eventId_idx" ON "evaluation_committees"("eventId");
CREATE UNIQUE INDEX "evaluation_committees_eventId_key_key" ON "evaluation_committees"("eventId", "key");
CREATE INDEX "evaluation_committee_members_reviewerId_idx" ON "evaluation_committee_members"("reviewerId");
CREATE UNIQUE INDEX "evaluation_assignments_roundId_submissionId_reviewerId_key" ON "evaluation_assignments"("roundId", "submissionId", "reviewerId");
CREATE INDEX "evaluation_assignments_submissionId_roundId_idx" ON "evaluation_assignments"("submissionId", "roundId");
CREATE INDEX "evaluation_assignments_reviewerId_status_idx" ON "evaluation_assignments"("reviewerId", "status");
CREATE INDEX "evaluation_assignments_committeeId_idx" ON "evaluation_assignments"("committeeId");
CREATE UNIQUE INDEX "evaluations_assignmentId_key" ON "evaluations"("assignmentId");
CREATE INDEX "evaluations_status_submittedAt_idx" ON "evaluations"("status", "submittedAt");
CREATE UNIQUE INDEX "evaluation_results_evaluationId_criterionId_key" ON "evaluation_results"("evaluationId", "criterionId");
CREATE INDEX "evaluation_results_criterionId_idx" ON "evaluation_results"("criterionId");
CREATE UNIQUE INDEX "evaluation_decisions_submissionId_decisionNumber_key" ON "evaluation_decisions"("submissionId", "decisionNumber");
CREATE UNIQUE INDEX "evaluation_decisions_supersedesDecisionId_key" ON "evaluation_decisions"("supersedesDecisionId");
CREATE INDEX "evaluation_decisions_planVersionId_outcome_idx" ON "evaluation_decisions"("planVersionId", "outcome");
CREATE INDEX "evaluation_decisions_roundId_idx" ON "evaluation_decisions"("roundId");
CREATE INDEX "evaluation_decisions_submissionId_decidedAt_idx" ON "evaluation_decisions"("submissionId", "decidedAt");

ALTER TABLE "evaluation_plans" ADD CONSTRAINT "evaluation_plans_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_plan_versions" ADD CONSTRAINT "evaluation_plan_versions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "evaluation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_rounds" ADD CONSTRAINT "evaluation_rounds_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "evaluation_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_criteria" ADD CONSTRAINT "evaluation_criteria_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "evaluation_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_reviewers" ADD CONSTRAINT "evaluation_reviewers_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_committees" ADD CONSTRAINT "evaluation_committees_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_committee_members" ADD CONSTRAINT "evaluation_committee_members_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "evaluation_committees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_committee_members" ADD CONSTRAINT "evaluation_committee_members_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "evaluation_reviewers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_assignments" ADD CONSTRAINT "evaluation_assignments_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "evaluation_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_assignments" ADD CONSTRAINT "evaluation_assignments_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "cfp_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_assignments" ADD CONSTRAINT "evaluation_assignments_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "evaluation_reviewers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_assignments" ADD CONSTRAINT "evaluation_assignments_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "evaluation_committees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "evaluation_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "evaluation_criteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_decisions" ADD CONSTRAINT "evaluation_decisions_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "evaluation_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_decisions" ADD CONSTRAINT "evaluation_decisions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "evaluation_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_decisions" ADD CONSTRAINT "evaluation_decisions_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "cfp_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_decisions" ADD CONSTRAINT "evaluation_decisions_supersedesDecisionId_fkey" FOREIGN KEY ("supersedesDecisionId") REFERENCES "evaluation_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
