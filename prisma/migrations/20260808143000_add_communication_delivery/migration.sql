CREATE TYPE "MessageRecipientStatus" AS ENUM ('QUEUED', 'RETRY_SCHEDULED', 'DELIVERED', 'FAILED');
CREATE TYPE "DeliveryAttemptStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "DeliveryFailureClass" AS ENUM ('TRANSIENT', 'PERMANENT');

CREATE TABLE "communication_templates" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "communication_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_template_versions" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "subjectTemplate" TEXT NOT NULL,
    "htmlTemplate" TEXT NOT NULL,
    "textTemplate" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "communication_template_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "communication_template_versions_positive_version" CHECK ("version" > 0)
);

CREATE TABLE "message_deliveries" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "occurrenceKey" TEXT,
    "scheduledFor" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_recipients" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "subjectSnapshot" TEXT NOT NULL,
    "htmlSnapshot" TEXT NOT NULL,
    "textSnapshot" TEXT,
    "status" "MessageRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "nextAttemptAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "terminalAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "message_recipients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_recipients_state_timestamps" CHECK (
      ("status" = 'QUEUED' AND "nextAttemptAt" IS NULL AND "deliveredAt" IS NULL AND "terminalAt" IS NULL) OR
      ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" IS NOT NULL AND "deliveredAt" IS NULL AND "terminalAt" IS NULL) OR
      ("status" = 'DELIVERED' AND "nextAttemptAt" IS NULL AND "deliveredAt" IS NOT NULL AND "terminalAt" IS NOT NULL) OR
      ("status" = 'FAILED' AND "nextAttemptAt" IS NULL AND "deliveredAt" IS NULL AND "terminalAt" IS NOT NULL)
    )
);

CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" "DeliveryAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "failureClass" "DeliveryFailureClass",
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_attempts_positive_attempt" CHECK ("attemptNumber" > 0),
    CONSTRAINT "delivery_attempts_outcome" CHECK (
      ("status" = 'PENDING' AND "completedAt" IS NULL AND "failureClass" IS NULL) OR
      ("status" = 'SUCCEEDED' AND "completedAt" IS NOT NULL AND "failureClass" IS NULL) OR
      ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "failureClass" IS NOT NULL)
    )
);

CREATE INDEX "communication_templates_eventId_idx" ON "communication_templates"("eventId");
CREATE UNIQUE INDEX "communication_templates_id_eventId_key" ON "communication_templates"("id", "eventId");
CREATE UNIQUE INDEX "communication_templates_eventId_key_key" ON "communication_templates"("eventId", "key");
CREATE INDEX "communication_template_versions_templateId_idx" ON "communication_template_versions"("templateId");
CREATE UNIQUE INDEX "communication_template_versions_id_eventId_key" ON "communication_template_versions"("id", "eventId");
CREATE UNIQUE INDEX "communication_template_versions_templateId_version_key" ON "communication_template_versions"("templateId", "version");
CREATE INDEX "message_deliveries_eventId_scheduledFor_idx" ON "message_deliveries"("eventId", "scheduledFor");
CREATE INDEX "message_deliveries_templateVersionId_idx" ON "message_deliveries"("templateVersionId");
CREATE UNIQUE INDEX "message_deliveries_eventId_idempotencyKey_key" ON "message_deliveries"("eventId", "idempotencyKey");
CREATE UNIQUE INDEX "message_deliveries_eventId_occurrenceKey_key" ON "message_deliveries"("eventId", "occurrenceKey");
CREATE INDEX "message_recipients_deliveryId_status_idx" ON "message_recipients"("deliveryId", "status");
CREATE INDEX "message_recipients_status_nextAttemptAt_idx" ON "message_recipients"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "message_recipients_deliveryId_recipientKey_key" ON "message_recipients"("deliveryId", "recipientKey");
CREATE INDEX "delivery_attempts_recipientId_status_idx" ON "delivery_attempts"("recipientId", "status");
CREATE UNIQUE INDEX "delivery_attempts_recipientId_attemptNumber_key" ON "delivery_attempts"("recipientId", "attemptNumber");
CREATE UNIQUE INDEX "delivery_attempts_provider_providerMessageId_key" ON "delivery_attempts"("provider", "providerMessageId");

ALTER TABLE "communication_templates"
ADD CONSTRAINT "communication_templates_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "communication_template_versions"
ADD CONSTRAINT "communication_template_versions_templateId_eventId_fkey" FOREIGN KEY ("templateId", "eventId") REFERENCES "communication_templates"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_deliveries"
ADD CONSTRAINT "message_deliveries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_deliveries"
ADD CONSTRAINT "message_deliveries_templateVersionId_eventId_fkey" FOREIGN KEY ("templateVersionId", "eventId") REFERENCES "communication_template_versions"("id", "eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message_recipients"
ADD CONSTRAINT "message_recipients_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "message_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delivery_attempts"
ADD CONSTRAINT "delivery_attempts_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "message_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
