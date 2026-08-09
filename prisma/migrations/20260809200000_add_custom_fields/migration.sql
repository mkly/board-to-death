CREATE TYPE "CustomFieldEntityType" AS ENUM ('CONTACT', 'PROGRAM_SESSION', 'CONTACT_GROUP', 'CFP_SUBMISSION');
CREATE TYPE "CustomFieldType" AS ENUM (
  'SINGLE_LINE_TEXT',
  'LONG_TEXT',
  'NUMBER',
  'DATE',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'CHECKBOX',
  'URL',
  'FILE'
);

CREATE TABLE "custom_field_definitions" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "entityType" "CustomFieldEntityType" NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "type" "CustomFieldType" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL,
  "characterLimit" INTEGER,
  "options" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "custom_field_values" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "definitionId" UUID NOT NULL,
  "contactId" UUID,
  "sessionId" UUID,
  "groupId" UUID,
  "submissionId" UUID,
  "value" JSONB NOT NULL,
  "normalizedText" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_field_values_one_target_check" CHECK (num_nonnulls("contactId", "sessionId", "groupId", "submissionId") = 1)
);

CREATE UNIQUE INDEX "custom_field_definitions_eventId_id_key" ON "custom_field_definitions"("eventId", "id");
CREATE UNIQUE INDEX "custom_field_definitions_eventId_entityType_key_key" ON "custom_field_definitions"("eventId", "entityType", "key");
CREATE UNIQUE INDEX "custom_field_definitions_eventId_entityType_position_key" ON "custom_field_definitions"("eventId", "entityType", "position");
CREATE INDEX "custom_field_definitions_eventId_entityType_idx" ON "custom_field_definitions"("eventId", "entityType");
CREATE UNIQUE INDEX "custom_field_values_definitionId_contactId_key" ON "custom_field_values"("definitionId", "contactId");
CREATE UNIQUE INDEX "custom_field_values_definitionId_sessionId_key" ON "custom_field_values"("definitionId", "sessionId");
CREATE UNIQUE INDEX "custom_field_values_definitionId_groupId_key" ON "custom_field_values"("definitionId", "groupId");
CREATE UNIQUE INDEX "custom_field_values_definitionId_submissionId_key" ON "custom_field_values"("definitionId", "submissionId");
CREATE INDEX "custom_field_values_eventId_definitionId_normalizedText_idx" ON "custom_field_values"("eventId", "definitionId", "normalizedText");
CREATE INDEX "custom_field_values_eventId_contactId_idx" ON "custom_field_values"("eventId", "contactId");
CREATE INDEX "custom_field_values_eventId_sessionId_idx" ON "custom_field_values"("eventId", "sessionId");
CREATE INDEX "custom_field_values_eventId_groupId_idx" ON "custom_field_values"("eventId", "groupId");
CREATE INDEX "custom_field_values_eventId_submissionId_idx" ON "custom_field_values"("eventId", "submissionId");

ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_eventId_definitionId_fkey"
  FOREIGN KEY ("eventId", "definitionId") REFERENCES "custom_field_definitions"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_eventId_contactId_fkey"
  FOREIGN KEY ("eventId", "contactId") REFERENCES "contacts"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_eventId_sessionId_fkey"
  FOREIGN KEY ("eventId", "sessionId") REFERENCES "program_sessions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_eventId_groupId_fkey"
  FOREIGN KEY ("eventId", "groupId") REFERENCES "contact_groups"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_eventId_submissionId_fkey"
  FOREIGN KEY ("eventId", "submissionId") REFERENCES "cfp_submissions"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
