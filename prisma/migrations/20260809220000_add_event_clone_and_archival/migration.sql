ALTER TABLE "events"
ADD COLUMN "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN "clonedFromEventId" UUID;

ALTER TABLE "events"
ADD CONSTRAINT "events_clonedFromEventId_fkey"
FOREIGN KEY ("clonedFromEventId") REFERENCES "events"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "events_archivedAt_startsAt_idx" ON "events"("archivedAt", "startsAt");
CREATE INDEX "events_clonedFromEventId_idx" ON "events"("clonedFromEventId");
