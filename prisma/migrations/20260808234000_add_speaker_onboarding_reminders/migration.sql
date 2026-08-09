ALTER TABLE "speaker_task_assignments"
ADD COLUMN "remindersOptedOut" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "speaker_task_reminder_rules" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "daysBeforeDue" INTEGER NOT NULL,
    "sendAtMinute" INTEGER NOT NULL,
    "enabledAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "speaker_task_reminder_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_task_reminder_rules_daysBeforeDue_check" CHECK ("daysBeforeDue" >= 0),
    CONSTRAINT "speaker_task_reminder_rules_sendAtMinute_check" CHECK ("sendAtMinute" >= 0 AND "sendAtMinute" < 1440)
);

CREATE UNIQUE INDEX "speaker_task_reminder_rules_eventId_name_key"
ON "speaker_task_reminder_rules"("eventId", "name");

CREATE UNIQUE INDEX "speaker_task_reminder_rules_eventId_id_key"
ON "speaker_task_reminder_rules"("eventId", "id");

CREATE INDEX "speaker_task_reminder_rules_eventId_enabledAt_cancelledAt_idx"
ON "speaker_task_reminder_rules"("eventId", "enabledAt", "cancelledAt");

CREATE INDEX "speaker_task_reminder_rules_templateId_idx"
ON "speaker_task_reminder_rules"("templateId");

ALTER TABLE "speaker_task_reminder_rules"
ADD CONSTRAINT "speaker_task_reminder_rules_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "speaker_task_reminder_rules"
ADD CONSTRAINT "speaker_task_reminder_rules_templateId_eventId_fkey"
FOREIGN KEY ("templateId", "eventId") REFERENCES "communication_templates"("id", "eventId")
ON DELETE RESTRICT ON UPDATE CASCADE;
