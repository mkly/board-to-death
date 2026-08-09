CREATE TABLE "agenda_placements" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "agenda_placements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agenda_placements_positive_version" CHECK ("version" > 0),
    CONSTRAINT "agenda_placements_positive_duration" CHECK ("endsAt" > "startsAt")
);

CREATE TABLE "agenda_placement_tracks" (
    "eventId" UUID NOT NULL,
    "placementId" UUID NOT NULL,
    "trackId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "agenda_placement_tracks_pkey" PRIMARY KEY ("placementId", "trackId"),
    CONSTRAINT "agenda_placement_tracks_nonnegative_order" CHECK ("sortOrder" >= 0)
);

CREATE TABLE "agenda_placement_speakers" (
    "eventId" UUID NOT NULL,
    "placementId" UUID NOT NULL,
    "speakerId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "agenda_placement_speakers_pkey" PRIMARY KEY ("placementId", "speakerId"),
    CONSTRAINT "agenda_placement_speakers_nonnegative_order" CHECK ("sortOrder" >= 0)
);

CREATE UNIQUE INDEX "agenda_placements_eventId_id_key" ON "agenda_placements"("eventId", "id");
CREATE UNIQUE INDEX "agenda_placements_eventId_sessionId_key" ON "agenda_placements"("eventId", "sessionId");
CREATE INDEX "agenda_placements_eventId_startsAt_endsAt_idx" ON "agenda_placements"("eventId", "startsAt", "endsAt");
CREATE INDEX "agenda_placements_eventId_roomId_idx" ON "agenda_placements"("eventId", "roomId");
CREATE UNIQUE INDEX "agenda_placement_tracks_placementId_sortOrder_key" ON "agenda_placement_tracks"("placementId", "sortOrder");
CREATE INDEX "agenda_placement_tracks_eventId_trackId_idx" ON "agenda_placement_tracks"("eventId", "trackId");
CREATE UNIQUE INDEX "agenda_placement_speakers_placementId_sortOrder_key" ON "agenda_placement_speakers"("placementId", "sortOrder");
CREATE INDEX "agenda_placement_speakers_eventId_speakerId_idx" ON "agenda_placement_speakers"("eventId", "speakerId");
CREATE UNIQUE INDEX "rooms_eventId_id_key" ON "rooms"("eventId", "id");

ALTER TABLE "agenda_placements"
ADD CONSTRAINT "agenda_placements_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agenda_placements"
ADD CONSTRAINT "agenda_placements_eventId_sessionId_fkey" FOREIGN KEY ("eventId", "sessionId") REFERENCES "program_sessions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agenda_placements"
ADD CONSTRAINT "agenda_placements_eventId_roomId_fkey" FOREIGN KEY ("eventId", "roomId") REFERENCES "rooms"("eventId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agenda_placement_tracks"
ADD CONSTRAINT "agenda_placement_tracks_eventId_placementId_fkey" FOREIGN KEY ("eventId", "placementId") REFERENCES "agenda_placements"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agenda_placement_tracks"
ADD CONSTRAINT "agenda_placement_tracks_eventId_trackId_fkey" FOREIGN KEY ("eventId", "trackId") REFERENCES "tracks"("eventId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agenda_placement_speakers"
ADD CONSTRAINT "agenda_placement_speakers_eventId_placementId_fkey" FOREIGN KEY ("eventId", "placementId") REFERENCES "agenda_placements"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agenda_placement_speakers"
ADD CONSTRAINT "agenda_placement_speakers_eventId_speakerId_fkey" FOREIGN KEY ("eventId", "speakerId") REFERENCES "speakers"("eventId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
