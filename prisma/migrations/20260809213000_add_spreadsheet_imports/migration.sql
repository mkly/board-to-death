CREATE TYPE "SpreadsheetImportEntityType" AS ENUM ('CONTACT', 'PROGRAM_SESSION');
CREATE TYPE "SpreadsheetImportChangeAction" AS ENUM ('CREATED', 'UPDATED');

CREATE TABLE "spreadsheet_imports" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "entityType" "SpreadsheetImportEntityType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "spreadsheet_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "spreadsheet_import_changes" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "targetId" UUID NOT NULL,
    "action" "SpreadsheetImportChangeAction" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "spreadsheet_import_changes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "spreadsheet_imports_eventId_id_key" ON "spreadsheet_imports"("eventId", "id");
CREATE INDEX "spreadsheet_imports_eventId_createdAt_idx" ON "spreadsheet_imports"("eventId", "createdAt");
CREATE UNIQUE INDEX "spreadsheet_import_changes_importId_rowNumber_key" ON "spreadsheet_import_changes"("importId", "rowNumber");
CREATE INDEX "spreadsheet_import_changes_eventId_targetId_idx" ON "spreadsheet_import_changes"("eventId", "targetId");

ALTER TABLE "spreadsheet_imports" ADD CONSTRAINT "spreadsheet_imports_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "spreadsheet_import_changes" ADD CONSTRAINT "spreadsheet_import_changes_eventId_importId_fkey"
FOREIGN KEY ("eventId", "importId") REFERENCES "spreadsheet_imports"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
