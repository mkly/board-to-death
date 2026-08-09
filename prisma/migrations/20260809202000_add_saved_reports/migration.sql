CREATE TYPE "ReportBaseType" AS ENUM ('SESSION', 'CONTACT', 'GROUP', 'EVALUATION_PLAN');

CREATE TABLE "saved_reports" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "baseType" "ReportBaseType" NOT NULL,
  "columns" JSONB NOT NULL,
  "filters" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_reports_eventId_name_key" ON "saved_reports"("eventId", "name");
CREATE UNIQUE INDEX "saved_reports_eventId_id_key" ON "saved_reports"("eventId", "id");
CREATE INDEX "saved_reports_eventId_createdAt_idx" ON "saved_reports"("eventId", "createdAt");

ALTER TABLE "saved_reports"
ADD CONSTRAINT "saved_reports_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
