CREATE TYPE "EvaluationRoundStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED');
CREATE TYPE "ReviewerVisibility" AS ENUM ('IDENTIFIED', 'BLIND', 'ANONYMIZED');

CREATE TABLE "evaluation_plans" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_plans_name" CHECK (length(btrim("name")) > 0)
);

CREATE TABLE "evaluation_rounds" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" "EvaluationRoundStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewerVisibility" "ReviewerVisibility" NOT NULL,
    "visibilitySnapshot" "ReviewerVisibility",
    "activatedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evaluation_rounds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_rounds_name" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "evaluation_rounds_nonnegative_order" CHECK ("sortOrder" >= 0),
    CONSTRAINT "evaluation_rounds_lifecycle" CHECK (
        ("status" = 'DRAFT' AND "visibilitySnapshot" IS NULL AND "activatedAt" IS NULL AND "closedAt" IS NULL AND "archivedAt" IS NULL)
        OR ("status" = 'ACTIVE' AND "visibilitySnapshot" IS NOT NULL AND "activatedAt" IS NOT NULL AND "closedAt" IS NULL AND "archivedAt" IS NULL)
        OR ("status" = 'CLOSED' AND "visibilitySnapshot" IS NOT NULL AND "activatedAt" IS NOT NULL AND "closedAt" IS NOT NULL AND "archivedAt" IS NULL)
        OR ("status" = 'ARCHIVED' AND "visibilitySnapshot" IS NOT NULL AND "activatedAt" IS NOT NULL AND "closedAt" IS NOT NULL AND "archivedAt" IS NOT NULL)
    )
);

CREATE TABLE "evaluation_round_transitions" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "fromStatus" "EvaluationRoundStatus",
    "toStatus" "EvaluationRoundStatus" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evaluation_round_transitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_round_transitions_changes_status" CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus")
);

CREATE UNIQUE INDEX "evaluation_plans_eventId_key" ON "evaluation_plans"("eventId");
CREATE UNIQUE INDEX "evaluation_plans_eventId_id_key" ON "evaluation_plans"("eventId", "id");
CREATE UNIQUE INDEX "evaluation_rounds_planId_sortOrder_key" ON "evaluation_rounds"("planId", "sortOrder");
CREATE UNIQUE INDEX "evaluation_rounds_eventId_id_key" ON "evaluation_rounds"("eventId", "id");
CREATE INDEX "evaluation_rounds_eventId_status_idx" ON "evaluation_rounds"("eventId", "status");
CREATE UNIQUE INDEX "evaluation_rounds_one_active_per_plan" ON "evaluation_rounds"("planId") WHERE "status" = 'ACTIVE';
CREATE INDEX "evaluation_round_transitions_roundId_occurredAt_idx" ON "evaluation_round_transitions"("roundId", "occurredAt");

ALTER TABLE "evaluation_plans"
ADD CONSTRAINT "evaluation_plans_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evaluation_rounds"
ADD CONSTRAINT "evaluation_rounds_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evaluation_rounds"
ADD CONSTRAINT "evaluation_rounds_eventId_planId_fkey" FOREIGN KEY ("eventId", "planId") REFERENCES "evaluation_plans"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evaluation_round_transitions"
ADD CONSTRAINT "evaluation_round_transitions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "evaluation_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
