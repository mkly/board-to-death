CREATE TYPE "SpeakerWorkflowStatus" AS ENUM ('NOT_CONTACTED', 'INVITED', 'CONFIRMED', 'DECLINED');

ALTER TABLE "speakers"
ADD COLUMN "workflowStatus" "SpeakerWorkflowStatus" NOT NULL DEFAULT 'NOT_CONTACTED';
