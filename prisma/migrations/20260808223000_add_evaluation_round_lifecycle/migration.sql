ALTER TYPE "EvaluationRoundStatus" ADD VALUE 'ARCHIVED';

CREATE TYPE "ReviewerVisibility" AS ENUM ('IDENTIFIED', 'BLIND', 'ANONYMIZED');

ALTER TABLE "evaluation_rounds"
ADD COLUMN "reviewerVisibility" "ReviewerVisibility" NOT NULL DEFAULT 'BLIND',
ADD COLUMN "visibilitySnapshot" "ReviewerVisibility",
ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

UPDATE "evaluation_rounds"
SET "visibilitySnapshot" = "reviewerVisibility"
WHERE "status" IN ('OPEN', 'CLOSED');

ALTER TABLE "evaluation_rounds"
ADD CONSTRAINT "evaluation_rounds_lifecycle" CHECK (
  ("status" = 'PLANNED' AND "visibilitySnapshot" IS NULL AND "opensAt" IS NULL AND "closesAt" IS NULL AND "archivedAt" IS NULL)
  OR ("status" = 'OPEN' AND "visibilitySnapshot" IS NOT NULL AND "opensAt" IS NOT NULL AND "closesAt" IS NULL AND "archivedAt" IS NULL)
  OR ("status" = 'CLOSED' AND "visibilitySnapshot" IS NOT NULL AND "opensAt" IS NOT NULL AND "closesAt" IS NOT NULL AND "archivedAt" IS NULL)
  OR ("status" = 'ARCHIVED' AND "visibilitySnapshot" IS NOT NULL AND "opensAt" IS NOT NULL AND "closesAt" IS NOT NULL AND "archivedAt" IS NOT NULL)
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

INSERT INTO "evaluation_round_transitions" ("id", "roundId", "fromStatus", "toStatus", "occurredAt")
SELECT gen_random_uuid(), "id", NULL, "status", "createdAt"
FROM "evaluation_rounds";

CREATE INDEX "evaluation_round_transitions_roundId_occurredAt_idx"
ON "evaluation_round_transitions"("roundId", "occurredAt");

ALTER TABLE "evaluation_round_transitions"
ADD CONSTRAINT "evaluation_round_transitions_roundId_fkey"
FOREIGN KEY ("roundId") REFERENCES "evaluation_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
