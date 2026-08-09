ALTER TABLE "program_session_versions"
ADD COLUMN "categoryId" UUID;

CREATE INDEX "program_session_versions_eventId_categoryId_idx"
ON "program_session_versions"("eventId", "categoryId");

ALTER TABLE "program_session_versions"
ADD CONSTRAINT "program_session_versions_eventId_categoryId_fkey"
FOREIGN KEY ("eventId", "categoryId") REFERENCES "cfp_categories"("eventId", "id")
ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
