CREATE TYPE "CfpSubmissionKind" AS ENUM ('ABSTRACT', 'GUARANTEED_SESSION');
CREATE TYPE "CfpSubmissionStatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'WAITLISTED',
    'ACCEPTED',
    'REJECTED',
    'CONFIRMED'
);
CREATE TYPE "CfpSubmissionRevisionKind" AS ENUM ('DRAFT', 'FINAL');
CREATE TYPE "CfpSubmissionTransitionActor" AS ENUM ('SYSTEM', 'ADMIN', 'SPEAKER_CONFIRMATION');

CREATE TABLE "cfp_categories" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cfp_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cfp_submissions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "formVersionId" UUID NOT NULL,
    "kind" "CfpSubmissionKind" NOT NULL,
    "status" "CfpSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ(3),
    "reviewStartedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cfp_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_submissions_status_timestamps" CHECK (
        ("status" = 'DRAFT' AND "submittedAt" IS NULL AND "reviewStartedAt" IS NULL AND "decidedAt" IS NULL AND "confirmedAt" IS NULL)
        OR ("status" = 'SUBMITTED' AND "submittedAt" IS NOT NULL AND "reviewStartedAt" IS NULL AND "decidedAt" IS NULL AND "confirmedAt" IS NULL)
        OR ("status" = 'UNDER_REVIEW' AND "submittedAt" IS NOT NULL AND "reviewStartedAt" IS NOT NULL AND "decidedAt" IS NULL AND "confirmedAt" IS NULL)
        OR ("status" IN ('WAITLISTED', 'ACCEPTED', 'REJECTED') AND "submittedAt" IS NOT NULL AND "reviewStartedAt" IS NOT NULL AND "decidedAt" IS NOT NULL AND "confirmedAt" IS NULL)
        OR ("status" = 'CONFIRMED' AND "submittedAt" IS NOT NULL AND "reviewStartedAt" IS NOT NULL AND "decidedAt" IS NOT NULL AND "confirmedAt" IS NOT NULL)
    )
);

CREATE TABLE "cfp_submission_revisions" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "kind" "CfpSubmissionRevisionKind" NOT NULL,
    "formVersionId" UUID NOT NULL,
    "definitionSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cfp_submission_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_submission_revisions_positive_version" CHECK ("versionNumber" > 0)
);

CREATE TABLE "cfp_submission_answers" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "questionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    CONSTRAINT "cfp_submission_answers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_submission_answers_nonnegative_order" CHECK ("sortOrder" >= 0),
    CONSTRAINT "cfp_submission_answers_question_id" CHECK (length(btrim("questionId")) > 0)
);

CREATE TABLE "cfp_submission_categories" (
    "eventId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "cfp_submission_categories_pkey" PRIMARY KEY ("submissionId", "categoryId"),
    CONSTRAINT "cfp_submission_categories_nonnegative_order" CHECK ("sortOrder" >= 0)
);

CREATE TABLE "cfp_submission_transitions" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "fromStatus" "CfpSubmissionStatus",
    "toStatus" "CfpSubmissionStatus" NOT NULL,
    "actor" "CfpSubmissionTransitionActor" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cfp_submission_transitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_submission_transitions_changes_status" CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus")
);

CREATE INDEX "cfp_categories_eventId_idx" ON "cfp_categories"("eventId");
CREATE UNIQUE INDEX "cfp_categories_eventId_key_key" ON "cfp_categories"("eventId", "key");
CREATE UNIQUE INDEX "cfp_categories_eventId_id_key" ON "cfp_categories"("eventId", "id");
CREATE INDEX "cfp_submissions_eventId_status_idx" ON "cfp_submissions"("eventId", "status");
CREATE INDEX "cfp_submissions_formVersionId_idx" ON "cfp_submissions"("formVersionId");
CREATE UNIQUE INDEX "cfp_submissions_eventId_id_key" ON "cfp_submissions"("eventId", "id");
CREATE INDEX "cfp_submission_revisions_submissionId_kind_idx" ON "cfp_submission_revisions"("submissionId", "kind");
CREATE INDEX "cfp_submission_revisions_formVersionId_idx" ON "cfp_submission_revisions"("formVersionId");
CREATE UNIQUE INDEX "cfp_submission_revisions_submissionId_versionNumber_key" ON "cfp_submission_revisions"("submissionId", "versionNumber");
CREATE UNIQUE INDEX "cfp_submission_revisions_one_final" ON "cfp_submission_revisions"("submissionId") WHERE "kind" = 'FINAL';
CREATE INDEX "cfp_submission_answers_revisionId_idx" ON "cfp_submission_answers"("revisionId");
CREATE UNIQUE INDEX "cfp_submission_answers_revisionId_questionId_key" ON "cfp_submission_answers"("revisionId", "questionId");
CREATE UNIQUE INDEX "cfp_submission_answers_revisionId_sortOrder_key" ON "cfp_submission_answers"("revisionId", "sortOrder");
CREATE INDEX "cfp_submission_categories_eventId_categoryId_idx" ON "cfp_submission_categories"("eventId", "categoryId");
CREATE UNIQUE INDEX "cfp_submission_categories_submissionId_sortOrder_key" ON "cfp_submission_categories"("submissionId", "sortOrder");
CREATE INDEX "cfp_submission_transitions_submissionId_occurredAt_idx" ON "cfp_submission_transitions"("submissionId", "occurredAt");

ALTER TABLE "cfp_categories"
ADD CONSTRAINT "cfp_categories_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submissions"
ADD CONSTRAINT "cfp_submissions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submissions"
ADD CONSTRAINT "cfp_submissions_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "cfp_form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_revisions"
ADD CONSTRAINT "cfp_submission_revisions_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "cfp_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_revisions"
ADD CONSTRAINT "cfp_submission_revisions_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "cfp_form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_answers"
ADD CONSTRAINT "cfp_submission_answers_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "cfp_submission_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_categories"
ADD CONSTRAINT "cfp_submission_categories_eventId_submissionId_fkey" FOREIGN KEY ("eventId", "submissionId") REFERENCES "cfp_submissions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_categories"
ADD CONSTRAINT "cfp_submission_categories_eventId_categoryId_fkey" FOREIGN KEY ("eventId", "categoryId") REFERENCES "cfp_categories"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_transitions"
ADD CONSTRAINT "cfp_submission_transitions_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "cfp_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
