ALTER TABLE "speaker_task_definitions"
ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

DROP INDEX "speaker_task_definitions_eventId_idx";

CREATE INDEX "speaker_task_definitions_eventId_archivedAt_idx"
ON "speaker_task_definitions"("eventId", "archivedAt");
