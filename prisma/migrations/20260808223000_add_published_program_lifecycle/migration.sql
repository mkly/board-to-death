CREATE TYPE "PublishedProgramState" AS ENUM ('PUBLISHED', 'UNPUBLISHED');

CREATE TABLE "published_programs" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "published_programs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "published_program_versions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "publishedProgramId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "state" "PublishedProgramState" NOT NULL,
    "actorPrincipalId" TEXT NOT NULL,
    "snapshot" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "published_program_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "published_program_versions_positive_version" CHECK ("versionNumber" > 0),
    CONSTRAINT "published_program_versions_snapshot_matches_state" CHECK (
        ("state" = 'PUBLISHED' AND "snapshot" IS NOT NULL) OR
        ("state" = 'UNPUBLISHED' AND "snapshot" IS NULL)
    )
);

CREATE UNIQUE INDEX "published_programs_eventId_key" ON "published_programs"("eventId");
CREATE UNIQUE INDEX "published_programs_eventId_id_key" ON "published_programs"("eventId", "id");
CREATE UNIQUE INDEX "published_program_versions_publishedProgramId_versionNumber_key"
ON "published_program_versions"("publishedProgramId", "versionNumber");
CREATE INDEX "published_program_versions_eventId_state_createdAt_idx"
ON "published_program_versions"("eventId", "state", "createdAt");

ALTER TABLE "published_programs"
ADD CONSTRAINT "published_programs_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "published_program_versions"
ADD CONSTRAINT "published_program_versions_eventId_publishedProgramId_fkey"
FOREIGN KEY ("eventId", "publishedProgramId") REFERENCES "published_programs"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
