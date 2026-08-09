CREATE TYPE "CfpAccessPolicy" AS ENUM ('OPEN', 'RESTRICTED');

ALTER TABLE "cfp_form_versions"
ADD COLUMN "submissionKind" "CfpSubmissionKind",
ADD COLUMN "accessPolicy" "CfpAccessPolicy",
ADD COLUMN "welcomeTitle" TEXT,
ADD COLUMN "welcomeContent" TEXT,
ADD COLUMN "instructions" TEXT,
ADD COLUMN "termsContent" TEXT,
ADD COLUMN "consentRequired" BOOLEAN;
