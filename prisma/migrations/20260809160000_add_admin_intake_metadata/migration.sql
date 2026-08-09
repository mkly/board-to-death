ALTER TABLE "cfp_submissions"
  ADD COLUMN "intakeClientIdentifier" TEXT,
  ADD COLUMN "intakePayloadHash" TEXT,
  ADD COLUMN "intakeCreatedBy" TEXT,
  ADD COLUMN "intakeUpdatedBy" TEXT,
  ADD COLUMN "intakeImportedAt" TIMESTAMPTZ(3);

ALTER TABLE "program_sessions"
  ADD COLUMN "intakeClientIdentifier" TEXT,
  ADD COLUMN "intakePayloadHash" TEXT,
  ADD COLUMN "intakeCreatedBy" TEXT,
  ADD COLUMN "intakeUpdatedBy" TEXT,
  ADD COLUMN "intakeImportedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "cfp_submissions_eventId_intakeClientIdentifier_key"
  ON "cfp_submissions"("eventId", "intakeClientIdentifier");

CREATE UNIQUE INDEX "program_sessions_eventId_intakeClientIdentifier_key"
  ON "program_sessions"("eventId", "intakeClientIdentifier");
