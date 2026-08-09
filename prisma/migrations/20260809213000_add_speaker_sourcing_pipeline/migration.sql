CREATE TYPE "SpeakerProspectStageBehavior" AS ENUM ('OPEN', 'NURTURE', 'WON', 'LOST');
CREATE TYPE "SpeakerProspectActivityActor" AS ENUM ('USER', 'AUTOMATION');
CREATE TYPE "SpeakerProspectActivityKind" AS ENUM ('CREATED', 'STAGE_CHANGED', 'NOTE_ADDED', 'ASSIGNED_TO_EVENT');

CREATE TABLE "speaker_interest_forms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "publicId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "description" TEXT,
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "speaker_interest_forms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "speaker_prospect_stages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "behavior" "SpeakerProspectStageBehavior" NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "speaker_prospect_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "speaker_prospects" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "personId" UUID NOT NULL,
  "stageId" UUID NOT NULL,
  "sourceFormId" UUID,
  "sourceLabel" TEXT NOT NULL,
  "assignedEventId" UUID,
  "assignedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "speaker_prospects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "speaker_prospect_activities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "prospectId" UUID NOT NULL,
  "kind" "SpeakerProspectActivityKind" NOT NULL,
  "actor" "SpeakerProspectActivityActor" NOT NULL,
  "actorLabel" TEXT NOT NULL,
  "note" TEXT,
  "fromStageId" UUID,
  "toStageId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaker_prospect_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "speaker_interest_forms_publicId_key" ON "speaker_interest_forms"("publicId");
CREATE UNIQUE INDEX "speaker_interest_forms_eventId_id_key" ON "speaker_interest_forms"("eventId", "id");
CREATE INDEX "speaker_interest_forms_eventId_createdAt_idx" ON "speaker_interest_forms"("eventId", "createdAt");
CREATE UNIQUE INDEX "speaker_prospect_stages_eventId_behavior_key" ON "speaker_prospect_stages"("eventId", "behavior");
CREATE UNIQUE INDEX "speaker_prospect_stages_eventId_sortOrder_key" ON "speaker_prospect_stages"("eventId", "sortOrder");
CREATE UNIQUE INDEX "speaker_prospect_stages_eventId_id_key" ON "speaker_prospect_stages"("eventId", "id");
CREATE INDEX "speaker_prospect_stages_eventId_sortOrder_idx" ON "speaker_prospect_stages"("eventId", "sortOrder");
CREATE UNIQUE INDEX "speaker_prospects_eventId_personId_key" ON "speaker_prospects"("eventId", "personId");
CREATE UNIQUE INDEX "speaker_prospects_eventId_id_key" ON "speaker_prospects"("eventId", "id");
CREATE INDEX "speaker_prospects_eventId_stageId_updatedAt_idx" ON "speaker_prospects"("eventId", "stageId", "updatedAt");
CREATE INDEX "speaker_prospects_assignedEventId_idx" ON "speaker_prospects"("assignedEventId");
CREATE INDEX "speaker_prospect_activities_eventId_prospectId_createdAt_idx" ON "speaker_prospect_activities"("eventId", "prospectId", "createdAt");

ALTER TABLE "speaker_interest_forms" ADD CONSTRAINT "speaker_interest_forms_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speaker_prospect_stages" ADD CONSTRAINT "speaker_prospect_stages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speaker_prospects" ADD CONSTRAINT "speaker_prospects_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speaker_prospects" ADD CONSTRAINT "speaker_prospects_assignedEventId_fkey" FOREIGN KEY ("assignedEventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "speaker_prospects" ADD CONSTRAINT "speaker_prospects_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speaker_prospects" ADD CONSTRAINT "speaker_prospects_eventId_stageId_fkey" FOREIGN KEY ("eventId", "stageId") REFERENCES "speaker_prospect_stages"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "speaker_prospects" ADD CONSTRAINT "speaker_prospects_eventId_sourceFormId_fkey" FOREIGN KEY ("eventId", "sourceFormId") REFERENCES "speaker_interest_forms"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "speaker_prospect_activities" ADD CONSTRAINT "speaker_prospect_activities_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speaker_prospect_activities" ADD CONSTRAINT "speaker_prospect_activities_eventId_prospectId_fkey" FOREIGN KEY ("eventId", "prospectId") REFERENCES "speaker_prospects"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speaker_prospect_activities" ADD CONSTRAINT "speaker_prospect_activities_eventId_fromStageId_fkey" FOREIGN KEY ("eventId", "fromStageId") REFERENCES "speaker_prospect_stages"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "speaker_prospect_activities" ADD CONSTRAINT "speaker_prospect_activities_eventId_toStageId_fkey" FOREIGN KEY ("eventId", "toStageId") REFERENCES "speaker_prospect_stages"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
