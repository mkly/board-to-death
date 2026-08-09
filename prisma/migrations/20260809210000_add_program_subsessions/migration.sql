ALTER TABLE "program_sessions"
ADD COLUMN "parentSessionId" UUID;

ALTER TABLE "program_sessions"
ADD CONSTRAINT "program_sessions_parent_not_self"
CHECK ("parentSessionId" IS NULL OR "parentSessionId" <> "id");

CREATE INDEX "program_sessions_eventId_parentSessionId_idx"
ON "program_sessions"("eventId", "parentSessionId");

ALTER TABLE "program_sessions"
ADD CONSTRAINT "program_sessions_eventId_parentSessionId_fkey"
FOREIGN KEY ("eventId", "parentSessionId")
REFERENCES "program_sessions"("eventId", "id")
ON DELETE NO ACTION ON UPDATE CASCADE;
