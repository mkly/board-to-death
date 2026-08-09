ALTER TABLE "evaluation_round_transitions"
ADD COLUMN "actorId" TEXT,
ADD COLUMN "note" TEXT;

CREATE TABLE "evaluation_round_advancements" (
  "id" UUID NOT NULL,
  "sourceRoundId" UUID NOT NULL,
  "targetRoundId" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "actorId" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evaluation_round_advancements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evaluation_round_advancements_distinct_rounds" CHECK ("sourceRoundId" <> "targetRoundId")
);

CREATE UNIQUE INDEX "evaluation_round_advancements_sourceRoundId_submissionId_key"
ON "evaluation_round_advancements"("sourceRoundId", "submissionId");

CREATE UNIQUE INDEX "evaluation_round_advancements_targetRoundId_submissionId_key"
ON "evaluation_round_advancements"("targetRoundId", "submissionId");

CREATE INDEX "evaluation_round_advancements_submissionId_occurredAt_idx"
ON "evaluation_round_advancements"("submissionId", "occurredAt");

ALTER TABLE "evaluation_round_advancements"
ADD CONSTRAINT "evaluation_round_advancements_sourceRoundId_fkey"
FOREIGN KEY ("sourceRoundId") REFERENCES "evaluation_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evaluation_round_advancements"
ADD CONSTRAINT "evaluation_round_advancements_targetRoundId_fkey"
FOREIGN KEY ("targetRoundId") REFERENCES "evaluation_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evaluation_round_advancements"
ADD CONSTRAINT "evaluation_round_advancements_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "cfp_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "evaluation_correction_returns" (
  "id" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "evaluationVersion" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "note" TEXT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evaluation_correction_returns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evaluation_correction_returns_positive_version" CHECK ("evaluationVersion" > 0)
);

CREATE UNIQUE INDEX "evaluation_correction_returns_assignmentId_evaluationVersion_key"
ON "evaluation_correction_returns"("assignmentId", "evaluationVersion");

CREATE INDEX "evaluation_correction_returns_assignmentId_occurredAt_idx"
ON "evaluation_correction_returns"("assignmentId", "occurredAt");

ALTER TABLE "evaluation_correction_returns"
ADD CONSTRAINT "evaluation_correction_returns_assignmentId_fkey"
FOREIGN KEY ("assignmentId") REFERENCES "evaluation_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
