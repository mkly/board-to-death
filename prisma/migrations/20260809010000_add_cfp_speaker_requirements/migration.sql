ALTER TABLE "cfp_form_versions"
ADD COLUMN "minimumSpeakerCount" INTEGER,
ADD COLUMN "maximumSpeakerCount" INTEGER,
ADD COLUMN "requiredSpeakerFields" JSONB;
