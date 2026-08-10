ALTER TYPE "EvaluationAssignmentStatus" ADD VALUE 'RECUSED';

ALTER TABLE "evaluation_assignments"
ADD COLUMN "recusedAt" TIMESTAMPTZ(3);

ALTER TABLE "evaluation_assignments"
DROP CONSTRAINT "evaluation_assignments_status_timestamps";

ALTER TABLE "evaluation_assignments"
ADD CONSTRAINT "evaluation_assignments_status_timestamps" CHECK (
    ("status" = 'ASSIGNED' AND "completedAt" IS NULL AND "recusedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "recusedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'RECUSED' AND "recusedAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "completedAt" IS NULL AND "recusedAt" IS NULL AND "revokedAt" IS NOT NULL)
);
