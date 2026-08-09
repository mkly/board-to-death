-- CreateEnum
CREATE TYPE "EvaluationRecommendation" AS ENUM ('ACCEPT', 'WAITLIST', 'REJECT');

-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "recommendation" "EvaluationRecommendation",
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
