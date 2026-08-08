CREATE TABLE "speakers" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "speakers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speakers_normalized_email" CHECK ("normalizedEmail" = lower(btrim("normalizedEmail")) AND length("normalizedEmail") > 0)
);

CREATE TABLE "speaker_profile_versions" (
    "id" UUID NOT NULL,
    "speakerId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "givenName" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "preferredName" TEXT,
    "pronouns" TEXT,
    "phone" TEXT,
    "organization" TEXT,
    "jobTitle" TEXT,
    "biography" TEXT,
    "websiteUrl" TEXT,
    "photoObjectKey" TEXT,
    "consentToPublishProfile" BOOLEAN NOT NULL DEFAULT false,
    "consentToReceiveEmail" BOOLEAN NOT NULL DEFAULT false,
    "consentedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "speaker_profile_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_profile_versions_positive_version" CHECK ("versionNumber" > 0),
    CONSTRAINT "speaker_profile_versions_required_fields" CHECK (
        length(btrim("email")) > 0 AND length(btrim("givenName")) > 0 AND length(btrim("familyName")) > 0
    ),
    CONSTRAINT "speaker_profile_versions_consent_timestamp" CHECK (
        (NOT "consentToPublishProfile" AND NOT "consentToReceiveEmail") OR "consentedAt" IS NOT NULL
    )
);

CREATE TABLE "cfp_submission_participants" (
    "eventId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "speakerId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "cfp_submission_participants_pkey" PRIMARY KEY ("submissionId", "speakerId"),
    CONSTRAINT "cfp_submission_participants_nonnegative_order" CHECK ("sortOrder" >= 0)
);

CREATE INDEX "speakers_eventId_idx" ON "speakers"("eventId");
CREATE UNIQUE INDEX "speakers_eventId_normalizedEmail_key" ON "speakers"("eventId", "normalizedEmail");
CREATE UNIQUE INDEX "speakers_eventId_id_key" ON "speakers"("eventId", "id");
CREATE INDEX "speaker_profile_versions_speakerId_idx" ON "speaker_profile_versions"("speakerId");
CREATE UNIQUE INDEX "speaker_profile_versions_speakerId_versionNumber_key" ON "speaker_profile_versions"("speakerId", "versionNumber");
CREATE UNIQUE INDEX "cfp_submission_participants_submissionId_sortOrder_key" ON "cfp_submission_participants"("submissionId", "sortOrder");
CREATE INDEX "cfp_submission_participants_eventId_speakerId_idx" ON "cfp_submission_participants"("eventId", "speakerId");

ALTER TABLE "speakers"
ADD CONSTRAINT "speakers_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "speaker_profile_versions"
ADD CONSTRAINT "speaker_profile_versions_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "speakers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_participants"
ADD CONSTRAINT "cfp_submission_participants_eventId_submissionId_fkey" FOREIGN KEY ("eventId", "submissionId") REFERENCES "cfp_submissions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_participants"
ADD CONSTRAINT "cfp_submission_participants_eventId_speakerId_fkey" FOREIGN KEY ("eventId", "speakerId") REFERENCES "speakers"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
