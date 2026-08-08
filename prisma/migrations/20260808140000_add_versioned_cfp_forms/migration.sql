CREATE TABLE "cfp_forms" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cfp_forms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cfp_form_versions" (
    "id" UUID NOT NULL,
    "formId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "customTypes" JSONB NOT NULL,
    "categories" JSONB,
    "categoryRules" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cfp_form_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_form_versions_positive_version" CHECK ("versionNumber" > 0),
    CONSTRAINT "cfp_form_versions_positive_schema" CHECK ("schemaVersion" > 0)
);

CREATE TABLE "cfp_form_steps" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "cfp_form_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_form_steps_valid_kind" CHECK ("kind" IN ('speaker', 'questions')),
    CONSTRAINT "cfp_form_steps_nonnegative_order" CHECK ("sortOrder" >= 0)
);

CREATE TABLE "cfp_form_questions" (
    "id" UUID NOT NULL,
    "stepId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL,
    "constraints" JSONB,
    "visibleWhen" JSONB,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "cfp_form_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cfp_form_questions_nonnegative_order" CHECK ("sortOrder" >= 0)
);

CREATE INDEX "cfp_forms_eventId_idx" ON "cfp_forms"("eventId");
CREATE UNIQUE INDEX "cfp_forms_eventId_key_key" ON "cfp_forms"("eventId", "key");
CREATE INDEX "cfp_form_versions_formId_idx" ON "cfp_form_versions"("formId");
CREATE UNIQUE INDEX "cfp_form_versions_formId_versionNumber_key" ON "cfp_form_versions"("formId", "versionNumber");
CREATE INDEX "cfp_form_steps_versionId_idx" ON "cfp_form_steps"("versionId");
CREATE UNIQUE INDEX "cfp_form_steps_versionId_key_key" ON "cfp_form_steps"("versionId", "key");
CREATE UNIQUE INDEX "cfp_form_steps_versionId_sortOrder_key" ON "cfp_form_steps"("versionId", "sortOrder");
CREATE INDEX "cfp_form_questions_stepId_idx" ON "cfp_form_questions"("stepId");
CREATE UNIQUE INDEX "cfp_form_questions_stepId_key_key" ON "cfp_form_questions"("stepId", "key");
CREATE UNIQUE INDEX "cfp_form_questions_stepId_sortOrder_key" ON "cfp_form_questions"("stepId", "sortOrder");

ALTER TABLE "cfp_forms"
ADD CONSTRAINT "cfp_forms_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_form_versions"
ADD CONSTRAINT "cfp_form_versions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "cfp_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_form_steps"
ADD CONSTRAINT "cfp_form_steps_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "cfp_form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_form_questions"
ADD CONSTRAINT "cfp_form_questions_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "cfp_form_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
