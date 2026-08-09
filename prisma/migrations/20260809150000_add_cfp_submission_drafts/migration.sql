CREATE TABLE "cfp_submission_drafts" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "formVersionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "participants" JSONB NOT NULL,
    "categoryKeys" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cfp_submission_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cfp_submission_drafts_tokenHash_key" ON "cfp_submission_drafts"("tokenHash");
CREATE INDEX "cfp_submission_drafts_policyId_expiresAt_idx" ON "cfp_submission_drafts"("policyId", "expiresAt");

ALTER TABLE "cfp_submission_drafts"
ADD CONSTRAINT "cfp_submission_drafts_eventId_policyId_fkey" FOREIGN KEY ("eventId", "policyId") REFERENCES "cfp_policies"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_drafts"
ADD CONSTRAINT "cfp_submission_drafts_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "cfp_form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
