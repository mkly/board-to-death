CREATE TYPE "ProgramSessionContentApprovalStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED');

ALTER TABLE "program_sessions"
ADD COLUMN "contentApprovalStatus" "ProgramSessionContentApprovalStatus" NOT NULL DEFAULT 'DRAFT';
