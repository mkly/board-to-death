CREATE TYPE "IntegrationProvider" AS ENUM ('ACCELEVENTS');
CREATE TYPE "IntegrationRemoteRecordStatus" AS ENUM ('ACTIVE', 'STALE');
CREATE TYPE "IntegrationSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED');
CREATE TYPE "IntegrationSyncRecordStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'SKIPPED', 'VALIDATION_FAILED', 'RETRIABLE_FAILED', 'TERMINAL_FAILED');

CREATE TABLE "integration_configurations" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_configurations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_configuration_versions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "remoteEventId" TEXT NOT NULL,
    "credentialReference" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_configuration_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_configuration_versions_positive_version" CHECK ("versionNumber" > 0),
    CONSTRAINT "integration_configuration_versions_required_remote_event" CHECK (length(btrim("remoteEventId")) > 0),
    CONSTRAINT "integration_configuration_versions_required_credential_reference" CHECK (length(btrim("credentialReference")) > 0)
);

CREATE TABLE "integration_field_mappings" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "resourceType" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_field_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_field_mappings_required_resource_type" CHECK (length(btrim("resourceType")) > 0),
    CONSTRAINT "integration_field_mappings_required_key" CHECK (length(btrim("key")) > 0)
);

CREATE TABLE "integration_field_mapping_versions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "mappingId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_field_mapping_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_field_mapping_versions_positive_version" CHECK ("versionNumber" > 0)
);

CREATE TABLE "integration_remote_records" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "mappingVersionId" UUID,
    "resourceType" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "status" "IntegrationRemoteRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "comparisonHash" TEXT,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "staleAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_remote_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_remote_records_required_resource_type" CHECK (length(btrim("resourceType")) > 0),
    CONSTRAINT "integration_remote_records_required_local_id" CHECK (length(btrim("localId")) > 0),
    CONSTRAINT "integration_remote_records_required_remote_id" CHECK (length(btrim("remoteId")) > 0),
    CONSTRAINT "integration_remote_records_stale_state" CHECK (
      ("status" = 'ACTIVE' AND "staleAt" IS NULL) OR
      ("status" = 'STALE' AND "staleAt" IS NOT NULL)
    )
);

CREATE TABLE "integration_sync_runs" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "configurationVersionId" UUID NOT NULL,
    "mappingVersionId" UUID NOT NULL,
    "retryOfRunId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "status" "IntegrationSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelRequestedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_sync_runs_required_idempotency_key" CHECK (length(btrim("idempotencyKey")) > 0),
    CONSTRAINT "integration_sync_runs_state_timestamps" CHECK (
      ("status" = 'PENDING' AND "startedAt" IS NULL AND "completedAt" IS NULL) OR
      ("status" = 'RUNNING' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL) OR
      ("status" IN ('SUCCEEDED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED') AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL)
    )
);

CREATE TABLE "integration_sync_records" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "remoteRecordId" UUID,
    "retryOfRecordId" UUID,
    "resourceType" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "remoteId" TEXT,
    "inputHash" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "IntegrationSyncRecordStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "redactedRequestContext" JSONB NOT NULL,
    "retryAfter" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_sync_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_sync_records_positive_attempt" CHECK ("attemptNumber" > 0),
    CONSTRAINT "integration_sync_records_required_resource_type" CHECK (length(btrim("resourceType")) > 0),
    CONSTRAINT "integration_sync_records_required_local_id" CHECK (length(btrim("localId")) > 0),
    CONSTRAINT "integration_sync_records_required_input_hash" CHECK (length(btrim("inputHash")) > 0),
    CONSTRAINT "integration_sync_records_state_timestamps" CHECK (
      ("status" = 'PENDING' AND "completedAt" IS NULL AND "retryAfter" IS NULL) OR
      ("status" = 'RETRIABLE_FAILED' AND "completedAt" IS NOT NULL AND "retryAfter" IS NOT NULL) OR
      ("status" IN ('SUCCEEDED', 'SKIPPED', 'VALIDATION_FAILED', 'TERMINAL_FAILED') AND "completedAt" IS NOT NULL AND "retryAfter" IS NULL)
    )
);

CREATE UNIQUE INDEX "integration_configurations_eventId_provider_key" ON "integration_configurations"("eventId", "provider");
CREATE UNIQUE INDEX "integration_configurations_eventId_id_key" ON "integration_configurations"("eventId", "id");
CREATE UNIQUE INDEX "integration_configuration_versions_configurationId_versionNumber_key" ON "integration_configuration_versions"("configurationId", "versionNumber");
CREATE UNIQUE INDEX "integration_configuration_versions_eventId_configurationId_id_key" ON "integration_configuration_versions"("eventId", "configurationId", "id");
CREATE INDEX "integration_configuration_versions_eventId_configurationId_idx" ON "integration_configuration_versions"("eventId", "configurationId");
CREATE UNIQUE INDEX "integration_field_mappings_configurationId_resourceType_key_key" ON "integration_field_mappings"("configurationId", "resourceType", "key");
CREATE UNIQUE INDEX "integration_field_mappings_eventId_configurationId_id_key" ON "integration_field_mappings"("eventId", "configurationId", "id");
CREATE INDEX "integration_field_mappings_eventId_configurationId_idx" ON "integration_field_mappings"("eventId", "configurationId");
CREATE UNIQUE INDEX "integration_field_mapping_versions_mappingId_versionNumber_key" ON "integration_field_mapping_versions"("mappingId", "versionNumber");
CREATE UNIQUE INDEX "integration_field_mapping_versions_eventId_configurationId_id_key" ON "integration_field_mapping_versions"("eventId", "configurationId", "id");
CREATE INDEX "integration_field_mapping_versions_eventId_configurationId_mappingId_idx" ON "integration_field_mapping_versions"("eventId", "configurationId", "mappingId");
CREATE UNIQUE INDEX "integration_remote_records_configurationId_resourceType_localId_key" ON "integration_remote_records"("configurationId", "resourceType", "localId");
CREATE UNIQUE INDEX "integration_remote_records_configurationId_resourceType_remoteId_key" ON "integration_remote_records"("configurationId", "resourceType", "remoteId");
CREATE UNIQUE INDEX "integration_remote_records_eventId_configurationId_id_key" ON "integration_remote_records"("eventId", "configurationId", "id");
CREATE INDEX "integration_remote_records_eventId_status_idx" ON "integration_remote_records"("eventId", "status");
CREATE INDEX "integration_remote_records_mappingVersionId_idx" ON "integration_remote_records"("mappingVersionId");
CREATE UNIQUE INDEX "integration_sync_runs_configurationId_idempotencyKey_key" ON "integration_sync_runs"("configurationId", "idempotencyKey");
CREATE UNIQUE INDEX "integration_sync_runs_eventId_configurationId_id_key" ON "integration_sync_runs"("eventId", "configurationId", "id");
CREATE INDEX "integration_sync_runs_eventId_status_createdAt_idx" ON "integration_sync_runs"("eventId", "status", "createdAt");
CREATE INDEX "integration_sync_runs_retryOfRunId_idx" ON "integration_sync_runs"("retryOfRunId");
CREATE UNIQUE INDEX "integration_sync_runs_one_active_per_configuration" ON "integration_sync_runs"("configurationId") WHERE "status" IN ('PENDING', 'RUNNING');
CREATE UNIQUE INDEX "integration_sync_records_runId_resourceType_localId_key" ON "integration_sync_records"("runId", "resourceType", "localId");
CREATE UNIQUE INDEX "integration_sync_records_eventId_configurationId_retryOfRecordId_key" ON "integration_sync_records"("eventId", "configurationId", "retryOfRecordId");
CREATE UNIQUE INDEX "integration_sync_records_eventId_configurationId_id_key" ON "integration_sync_records"("eventId", "configurationId", "id");
CREATE INDEX "integration_sync_records_eventId_status_retryAfter_idx" ON "integration_sync_records"("eventId", "status", "retryAfter");
CREATE INDEX "integration_sync_records_remoteRecordId_idx" ON "integration_sync_records"("remoteRecordId");

ALTER TABLE "integration_configurations"
ADD CONSTRAINT "integration_configurations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_configuration_versions"
ADD CONSTRAINT "integration_configuration_versions_eventId_configurationId_fkey" FOREIGN KEY ("eventId", "configurationId") REFERENCES "integration_configurations"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_field_mappings"
ADD CONSTRAINT "integration_field_mappings_eventId_configurationId_fkey" FOREIGN KEY ("eventId", "configurationId") REFERENCES "integration_configurations"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_field_mapping_versions"
ADD CONSTRAINT "integration_field_mapping_versions_eventId_configurationId_mappingId_fkey" FOREIGN KEY ("eventId", "configurationId", "mappingId") REFERENCES "integration_field_mappings"("eventId", "configurationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_remote_records"
ADD CONSTRAINT "integration_remote_records_eventId_configurationId_fkey" FOREIGN KEY ("eventId", "configurationId") REFERENCES "integration_configurations"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_remote_records"
ADD CONSTRAINT "integration_remote_records_eventId_configurationId_mappingVersionId_fkey" FOREIGN KEY ("eventId", "configurationId", "mappingVersionId") REFERENCES "integration_field_mapping_versions"("eventId", "configurationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_sync_runs"
ADD CONSTRAINT "integration_sync_runs_eventId_configurationId_fkey" FOREIGN KEY ("eventId", "configurationId") REFERENCES "integration_configurations"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_sync_runs"
ADD CONSTRAINT "integration_sync_runs_eventId_configurationId_configurationVersionId_fkey" FOREIGN KEY ("eventId", "configurationId", "configurationVersionId") REFERENCES "integration_configuration_versions"("eventId", "configurationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_sync_runs"
ADD CONSTRAINT "integration_sync_runs_eventId_configurationId_mappingVersionId_fkey" FOREIGN KEY ("eventId", "configurationId", "mappingVersionId") REFERENCES "integration_field_mapping_versions"("eventId", "configurationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_sync_runs"
ADD CONSTRAINT "integration_sync_runs_eventId_configurationId_retryOfRunId_fkey" FOREIGN KEY ("eventId", "configurationId", "retryOfRunId") REFERENCES "integration_sync_runs"("eventId", "configurationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_sync_records"
ADD CONSTRAINT "integration_sync_records_eventId_configurationId_runId_fkey" FOREIGN KEY ("eventId", "configurationId", "runId") REFERENCES "integration_sync_runs"("eventId", "configurationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_sync_records"
ADD CONSTRAINT "integration_sync_records_eventId_configurationId_remoteRecordId_fkey" FOREIGN KEY ("eventId", "configurationId", "remoteRecordId") REFERENCES "integration_remote_records"("eventId", "configurationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_sync_records"
ADD CONSTRAINT "integration_sync_records_eventId_configurationId_retryOfRecordId_fkey" FOREIGN KEY ("eventId", "configurationId", "retryOfRecordId") REFERENCES "integration_sync_records"("eventId", "configurationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
