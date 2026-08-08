CREATE TYPE "ProgramSessionKind" AS ENUM ('GUARANTEED', 'MANUAL', 'PROMOTED');

CREATE TABLE "program_sessions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "kind" "ProgramSessionKind" NOT NULL,
    "sourceSubmissionId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "program_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "program_sessions_promoted_source" CHECK (
        ("kind" = 'PROMOTED' AND "sourceSubmissionId" IS NOT NULL)
        OR ("kind" <> 'PROMOTED' AND "sourceSubmissionId" IS NULL)
    )
);

CREATE TABLE "program_session_versions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "trackId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "program_session_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "program_session_versions_positive_version" CHECK ("versionNumber" > 0),
    CONSTRAINT "program_session_versions_required_title" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "program_session_versions_positive_duration" CHECK ("durationMinutes" > 0)
);

CREATE TABLE "program_session_participants" (
    "eventId" UUID NOT NULL,
    "sessionVersionId" UUID NOT NULL,
    "speakerId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "program_session_participants_pkey" PRIMARY KEY ("sessionVersionId", "speakerId"),
    CONSTRAINT "program_session_participants_nonnegative_order" CHECK ("sortOrder" >= 0)
);

CREATE UNIQUE INDEX "program_sessions_sourceSubmissionId_key" ON "program_sessions"("sourceSubmissionId");
CREATE UNIQUE INDEX "program_sessions_eventId_id_key" ON "program_sessions"("eventId", "id");
CREATE UNIQUE INDEX "program_sessions_eventId_sourceSubmissionId_key" ON "program_sessions"("eventId", "sourceSubmissionId");
CREATE INDEX "program_sessions_eventId_kind_archivedAt_idx" ON "program_sessions"("eventId", "kind", "archivedAt");
CREATE UNIQUE INDEX "program_session_versions_sessionId_versionNumber_key" ON "program_session_versions"("sessionId", "versionNumber");
CREATE UNIQUE INDEX "program_session_versions_eventId_id_key" ON "program_session_versions"("eventId", "id");
CREATE INDEX "program_session_versions_eventId_trackId_idx" ON "program_session_versions"("eventId", "trackId");
CREATE UNIQUE INDEX "program_session_participants_sessionVersionId_sortOrder_key" ON "program_session_participants"("sessionVersionId", "sortOrder");
CREATE INDEX "program_session_participants_eventId_speakerId_idx" ON "program_session_participants"("eventId", "speakerId");
CREATE UNIQUE INDEX "tracks_eventId_id_key" ON "tracks"("eventId", "id");

ALTER TABLE "program_sessions"
ADD CONSTRAINT "program_sessions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_sessions"
ADD CONSTRAINT "program_sessions_eventId_sourceSubmissionId_fkey" FOREIGN KEY ("eventId", "sourceSubmissionId") REFERENCES "cfp_submissions"("eventId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "program_session_versions"
ADD CONSTRAINT "program_session_versions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_session_versions"
ADD CONSTRAINT "program_session_versions_eventId_sessionId_fkey" FOREIGN KEY ("eventId", "sessionId") REFERENCES "program_sessions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_session_versions"
ADD CONSTRAINT "program_session_versions_eventId_trackId_fkey" FOREIGN KEY ("eventId", "trackId") REFERENCES "tracks"("eventId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "program_session_participants"
ADD CONSTRAINT "program_session_participants_eventId_sessionVersionId_fkey" FOREIGN KEY ("eventId", "sessionVersionId") REFERENCES "program_session_versions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_session_participants"
ADD CONSTRAINT "program_session_participants_eventId_speakerId_fkey" FOREIGN KEY ("eventId", "speakerId") REFERENCES "speakers"("eventId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
