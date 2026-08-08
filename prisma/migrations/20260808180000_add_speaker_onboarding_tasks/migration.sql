CREATE TYPE "SpeakerTaskAssignmentStatus" AS ENUM (
    'PENDING',
    'SUBMITTED',
    'APPROVED',
    'REVISION_REQUESTED',
    'WITHDRAWN'
);

CREATE TABLE "speaker_task_definitions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "speaker_task_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_task_definitions_key" CHECK (length(btrim("key")) > 0)
);

CREATE TABLE "speaker_task_definition_versions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "applicability" JSONB NOT NULL,
    "defaultDueOffsetDays" INTEGER,
    "responseRequired" BOOLEAN NOT NULL DEFAULT false,
    "responseSchema" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "speaker_task_definition_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_task_definition_versions_positive_version" CHECK ("versionNumber" > 0),
    CONSTRAINT "speaker_task_definition_versions_nonnegative_order" CHECK ("sortOrder" >= 0),
    CONSTRAINT "speaker_task_definition_versions_title" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "speaker_task_definition_versions_due_offset" CHECK ("defaultDueOffsetDays" IS NULL OR "defaultDueOffsetDays" >= 0),
    CONSTRAINT "speaker_task_definition_versions_response_schema" CHECK (NOT "responseRequired" OR "responseSchema" IS NOT NULL)
);

CREATE TABLE "speaker_task_assignments" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "definitionVersionId" UUID NOT NULL,
    "speakerId" UUID NOT NULL,
    "status" "SpeakerTaskAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "speaker_task_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_task_assignments_due_after_assignment" CHECK ("dueAt" IS NULL OR "dueAt" >= "assignedAt"),
    CONSTRAINT "speaker_task_assignments_status_timestamps" CHECK (
        ("status" = 'PENDING' AND "submittedAt" IS NULL AND "completedAt" IS NULL AND "withdrawnAt" IS NULL)
        OR ("status" IN ('SUBMITTED', 'REVISION_REQUESTED') AND "submittedAt" IS NOT NULL AND "completedAt" IS NULL AND "withdrawnAt" IS NULL)
        OR ("status" = 'APPROVED' AND "submittedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "withdrawnAt" IS NULL)
        OR ("status" = 'WITHDRAWN' AND "completedAt" IS NULL AND "withdrawnAt" IS NOT NULL)
    )
);

CREATE TABLE "speaker_task_submissions" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "response" JSONB,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "speaker_task_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_task_submissions_positive_attempt" CHECK ("attemptNumber" > 0)
);

CREATE TABLE "speaker_task_assignment_transitions" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "fromStatus" "SpeakerTaskAssignmentStatus",
    "toStatus" "SpeakerTaskAssignmentStatus" NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "speaker_task_assignment_transitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_task_assignment_transitions_changes_status" CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus")
);

CREATE UNIQUE INDEX "speaker_task_definitions_eventId_key_key" ON "speaker_task_definitions"("eventId", "key");
CREATE UNIQUE INDEX "speaker_task_definitions_eventId_id_key" ON "speaker_task_definitions"("eventId", "id");
CREATE INDEX "speaker_task_definitions_eventId_idx" ON "speaker_task_definitions"("eventId");
CREATE UNIQUE INDEX "speaker_task_definition_versions_definitionId_versionNumber_key" ON "speaker_task_definition_versions"("definitionId", "versionNumber");
CREATE UNIQUE INDEX "speaker_task_definition_versions_eventId_definitionId_id_key" ON "speaker_task_definition_versions"("eventId", "definitionId", "id");
CREATE INDEX "speaker_task_definition_versions_eventId_sortOrder_idx" ON "speaker_task_definition_versions"("eventId", "sortOrder");
CREATE UNIQUE INDEX "speaker_task_assignments_definitionId_speakerId_key" ON "speaker_task_assignments"("definitionId", "speakerId");
CREATE UNIQUE INDEX "speaker_task_assignments_eventId_id_key" ON "speaker_task_assignments"("eventId", "id");
CREATE INDEX "speaker_task_assignments_eventId_speakerId_status_idx" ON "speaker_task_assignments"("eventId", "speakerId", "status");
CREATE UNIQUE INDEX "speaker_task_submissions_assignmentId_attemptNumber_key" ON "speaker_task_submissions"("assignmentId", "attemptNumber");
CREATE INDEX "speaker_task_submissions_assignmentId_submittedAt_idx" ON "speaker_task_submissions"("assignmentId", "submittedAt");
CREATE INDEX "speaker_task_assignment_transitions_assignmentId_occurredAt_idx" ON "speaker_task_assignment_transitions"("assignmentId", "occurredAt");

ALTER TABLE "speaker_task_definitions"
ADD CONSTRAINT "speaker_task_definitions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "speaker_task_definition_versions"
ADD CONSTRAINT "speaker_task_definition_versions_eventId_definitionId_fkey" FOREIGN KEY ("eventId", "definitionId") REFERENCES "speaker_task_definitions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "speaker_task_assignments"
ADD CONSTRAINT "speaker_task_assignments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "speaker_task_assignments"
ADD CONSTRAINT "speaker_task_assignments_eventId_definitionId_fkey" FOREIGN KEY ("eventId", "definitionId") REFERENCES "speaker_task_definitions"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "speaker_task_assignments"
ADD CONSTRAINT "speaker_task_assignments_definition_version_fkey" FOREIGN KEY ("eventId", "definitionId", "definitionVersionId") REFERENCES "speaker_task_definition_versions"("eventId", "definitionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "speaker_task_assignments"
ADD CONSTRAINT "speaker_task_assignments_eventId_speakerId_fkey" FOREIGN KEY ("eventId", "speakerId") REFERENCES "speakers"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "speaker_task_submissions"
ADD CONSTRAINT "speaker_task_submissions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "speaker_task_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "speaker_task_assignment_transitions"
ADD CONSTRAINT "speaker_task_assignment_transitions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "speaker_task_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
