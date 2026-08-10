-- Contact and group assignees receive revocable, single-use upload links.
CREATE TABLE "file_request_fulfillment_links" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_request_fulfillment_links_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "file_request_files" ADD COLUMN "uploadedByContactId" UUID;

CREATE UNIQUE INDEX "file_request_fulfillment_links_tokenHash_key"
ON "file_request_fulfillment_links"("tokenHash");

CREATE INDEX "file_request_fulfillment_links_assignmentId_contactId_consumedAt_idx"
ON "file_request_fulfillment_links"("assignmentId", "contactId", "consumedAt");

CREATE INDEX "file_request_fulfillment_links_expiresAt_idx"
ON "file_request_fulfillment_links"("expiresAt");

CREATE INDEX "file_request_files_uploadedByContactId_idx"
ON "file_request_files"("uploadedByContactId");

ALTER TABLE "file_request_fulfillment_links"
ADD CONSTRAINT "file_request_fulfillment_links_assignmentId_fkey"
FOREIGN KEY ("assignmentId") REFERENCES "file_request_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_request_fulfillment_links"
ADD CONSTRAINT "file_request_fulfillment_links_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_request_files"
ADD CONSTRAINT "file_request_files_uploadedByContactId_fkey"
FOREIGN KEY ("uploadedByContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
