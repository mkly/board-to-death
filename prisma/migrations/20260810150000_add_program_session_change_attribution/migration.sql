ALTER TABLE "program_session_versions"
ADD COLUMN "createdBy" TEXT,
ADD COLUMN "restoredFromVersionNumber" INTEGER;

ALTER TABLE "program_session_versions"
ADD CONSTRAINT "program_session_versions_restoredFromVersionNumber_check"
CHECK ("restoredFromVersionNumber" IS NULL OR "restoredFromVersionNumber" > 0);
