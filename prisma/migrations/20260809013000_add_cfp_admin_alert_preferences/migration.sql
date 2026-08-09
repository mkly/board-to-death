ALTER TABLE "cfp_policy_admin_assignments"
ADD COLUMN "notifyOnNewSubmission" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "notifyOnSubmissionUpdate" BOOLEAN NOT NULL DEFAULT false;
