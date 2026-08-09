ALTER TABLE "cfp_submission_participants"
ADD COLUMN "confirmedAt" TIMESTAMPTZ(3);

CREATE TABLE "cfp_speaker_invitations" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "speakerId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cfp_speaker_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cfp_speaker_invitations_tokenHash_key"
ON "cfp_speaker_invitations"("tokenHash");

CREATE INDEX "cfp_speaker_invitations_eventId_submissionId_speakerId_createdAt_idx"
ON "cfp_speaker_invitations"("eventId", "submissionId", "speakerId", "createdAt");

CREATE INDEX "cfp_speaker_invitations_eventId_expiresAt_idx"
ON "cfp_speaker_invitations"("eventId", "expiresAt");

ALTER TABLE "cfp_speaker_invitations"
ADD CONSTRAINT "cfp_speaker_invitations_submissionId_speakerId_fkey"
FOREIGN KEY ("submissionId", "speakerId")
REFERENCES "cfp_submission_participants"("submissionId", "speakerId")
ON DELETE CASCADE ON UPDATE CASCADE;
