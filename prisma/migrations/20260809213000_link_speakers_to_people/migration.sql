ALTER TABLE "speakers" ADD COLUMN "personId" UUID;

UPDATE "speakers" AS speaker
SET "personId" = person."id"
FROM "people" AS person
WHERE speaker."normalizedEmail" = person."email";

CREATE UNIQUE INDEX "speakers_eventId_personId_key" ON "speakers"("eventId", "personId");
CREATE INDEX "speakers_personId_idx" ON "speakers"("personId");

ALTER TABLE "speakers"
ADD CONSTRAINT "speakers_personId_fkey"
FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
