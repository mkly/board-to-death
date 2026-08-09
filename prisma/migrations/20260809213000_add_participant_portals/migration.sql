CREATE TABLE "participant_portals" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "welcomeMessage" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT 'neutral',
    "logoObjectKey" TEXT,
    "backgroundObjectKey" TEXT,
    "sectionTitles" JSONB NOT NULL,
    "audienceRules" JSONB NOT NULL,
    "contentVisibility" JSONB NOT NULL,
    "profileFieldVisibility" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_portals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "participant_portals_eventId_slug_key" ON "participant_portals"("eventId", "slug");
CREATE UNIQUE INDEX "participant_portals_eventId_id_key" ON "participant_portals"("eventId", "id");
CREATE INDEX "participant_portals_eventId_sortOrder_idx" ON "participant_portals"("eventId", "sortOrder");

ALTER TABLE "participant_portals" ADD CONSTRAINT "participant_portals_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
