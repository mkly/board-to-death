-- AlterTable
ALTER TABLE "cfp_submission_participants" ADD COLUMN     "slidesObjectKey" TEXT,
ADD COLUMN     "supportingDocumentObjectKey" TEXT;

-- AlterTable
ALTER TABLE "speaker_profile_versions" ADD COLUMN     "agreementObjectKey" TEXT;

-- RenameForeignKey
ALTER TABLE "integration_field_mapping_versions" RENAME CONSTRAINT "integration_field_mapping_versions_eventId_configurationId_mapp" TO "integration_field_mapping_versions_eventId_configurationId_fkey";

-- RenameForeignKey
ALTER TABLE "integration_remote_records" RENAME CONSTRAINT "integration_remote_records_eventId_configurationId_mappingVersi" TO "integration_remote_records_eventId_configurationId_mapping_fkey";

-- RenameForeignKey
ALTER TABLE "integration_sync_records" RENAME CONSTRAINT "integration_sync_records_eventId_configurationId_remoteRecordId" TO "integration_sync_records_eventId_configurationId_remoteRec_fkey";

-- RenameForeignKey
ALTER TABLE "integration_sync_records" RENAME CONSTRAINT "integration_sync_records_eventId_configurationId_retryOfRecordI" TO "integration_sync_records_eventId_configurationId_retryOfRe_fkey";

-- RenameForeignKey
ALTER TABLE "integration_sync_runs" RENAME CONSTRAINT "integration_sync_runs_eventId_configurationId_configurationVers" TO "integration_sync_runs_eventId_configurationId_configuratio_fkey";

-- RenameForeignKey
ALTER TABLE "integration_sync_runs" RENAME CONSTRAINT "integration_sync_runs_eventId_configurationId_mappingVersionId_" TO "integration_sync_runs_eventId_configurationId_mappingVersi_fkey";

-- RenameForeignKey
ALTER TABLE "speaker_task_assignments" RENAME CONSTRAINT "speaker_task_assignments_definition_version_fkey" TO "speaker_task_assignments_eventId_definitionId_definitionVe_fkey";

-- RenameIndex
ALTER INDEX "integration_configuration_versions_configurationId_versionNumbe" RENAME TO "integration_configuration_versions_configurationId_versionN_key";

-- RenameIndex
ALTER INDEX "integration_configuration_versions_eventId_configurationId_id_k" RENAME TO "integration_configuration_versions_eventId_configurationId__key";

-- RenameIndex
ALTER INDEX "integration_field_mapping_versions_eventId_configurationId_id_k" RENAME TO "integration_field_mapping_versions_eventId_configurationId__key";

-- RenameIndex
ALTER INDEX "integration_field_mapping_versions_eventId_configurationId_mapp" RENAME TO "integration_field_mapping_versions_eventId_configurationId__idx";

-- RenameIndex
ALTER INDEX "integration_remote_records_configurationId_resourceType_localId" RENAME TO "integration_remote_records_configurationId_resourceType_loc_key";

-- RenameIndex
ALTER INDEX "integration_remote_records_configurationId_resourceType_remoteI" RENAME TO "integration_remote_records_configurationId_resourceType_rem_key";

-- RenameIndex
ALTER INDEX "integration_sync_records_eventId_configurationId_retryOfRecordI" RENAME TO "integration_sync_records_eventId_configurationId_retryOfRec_key";

-- RenameIndex
ALTER INDEX "speaker_resource_page_versions_eventId_publishedAt_unpublishedA" RENAME TO "speaker_resource_page_versions_eventId_publishedAt_unpublis_idx";
