CREATE TYPE "EventType" AS ENUM ('CONFERENCE', 'MEETUP', 'WORKSHOP', 'OTHER');

CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "EventType" NOT NULL DEFAULT 'CONFERENCE',
    "websiteUrl" TEXT,
    "location" TEXT,
    "timezone" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "theme" TEXT,
    "exhibitorsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sponsorsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "logoObjectKey" TEXT,
    "backgroundObjectKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_valid_date_bounds" CHECK ("startsAt" < "endsAt")
);

CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");
CREATE INDEX "rooms_eventId_idx" ON "rooms"("eventId");
CREATE UNIQUE INDEX "rooms_eventId_sortOrder_key" ON "rooms"("eventId", "sortOrder");
CREATE UNIQUE INDEX "rooms_eventId_name_key" ON "rooms"("eventId", lower("name"));
CREATE INDEX "tracks_eventId_idx" ON "tracks"("eventId");
CREATE UNIQUE INDEX "tracks_eventId_sortOrder_key" ON "tracks"("eventId", "sortOrder");
CREATE UNIQUE INDEX "tracks_eventId_name_key" ON "tracks"("eventId", lower("name"));

ALTER TABLE "rooms"
ADD CONSTRAINT "rooms_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tracks"
ADD CONSTRAINT "tracks_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
