CREATE TYPE "BulkEditEntityType" AS ENUM ('CONTACT', 'SESSION', 'GROUP');

CREATE TABLE "bulk_edit_operations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "entityType" "BulkEditEntityType" NOT NULL,
  "field" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "requestedCount" INTEGER NOT NULL,
  "succeededCount" INTEGER NOT NULL DEFAULT 0,
  "failureDetails" JSONB NOT NULL,
  "performedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "bulk_edit_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bulk_edit_operations_eventId_createdAt_idx"
ON "bulk_edit_operations"("eventId", "createdAt");

ALTER TABLE "bulk_edit_operations"
ADD CONSTRAINT "bulk_edit_operations_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
