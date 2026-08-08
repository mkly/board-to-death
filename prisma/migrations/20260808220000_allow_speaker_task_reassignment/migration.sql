DROP INDEX "speaker_task_assignments_definitionId_speakerId_key";

CREATE INDEX "speaker_task_assignments_definitionId_speakerId_idx"
ON "speaker_task_assignments"("definitionId", "speakerId");

CREATE UNIQUE INDEX "speaker_task_assignments_active_definition_speaker_key"
ON "speaker_task_assignments"("definitionId", "speakerId")
WHERE "status" <> 'WITHDRAWN';
