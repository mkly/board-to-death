CREATE TABLE "speaker_magic_links" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "speakerId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "speaker_magic_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "speaker_sessions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "speakerId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "speaker_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "speaker_magic_links_tokenHash_key" ON "speaker_magic_links"("tokenHash");
CREATE INDEX "speaker_magic_links_eventId_speakerId_expiresAt_idx" ON "speaker_magic_links"("eventId", "speakerId", "expiresAt");
CREATE UNIQUE INDEX "speaker_sessions_tokenHash_key" ON "speaker_sessions"("tokenHash");
CREATE INDEX "speaker_sessions_eventId_speakerId_expiresAt_idx" ON "speaker_sessions"("eventId", "speakerId", "expiresAt");

ALTER TABLE "speaker_magic_links"
ADD CONSTRAINT "speaker_magic_links_eventId_speakerId_fkey" FOREIGN KEY ("eventId", "speakerId") REFERENCES "speakers"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "speaker_sessions"
ADD CONSTRAINT "speaker_sessions_eventId_speakerId_fkey" FOREIGN KEY ("eventId", "speakerId") REFERENCES "speakers"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
