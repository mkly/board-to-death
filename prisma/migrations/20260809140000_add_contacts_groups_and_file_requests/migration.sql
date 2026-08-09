-- CreateEnum
CREATE TYPE "ContactGroupKind" AS ENUM ('EXHIBITOR', 'SPONSOR');

-- CreateEnum
CREATE TYPE "FileRequestTargetKind" AS ENUM ('CONTACT', 'GROUP', 'SUBMISSION');

-- CreateEnum
CREATE TYPE "FileRequestReplacementPolicy" AS ENUM ('REPLACE_LATEST', 'KEEP_HISTORY');

-- CreateEnum
CREATE TYPE "FileRequestAssignmentStatus" AS ENUM ('PENDING', 'FULFILLED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "givenName" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "organization" TEXT,
    "jobTitle" TEXT,
    "phone" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_groups" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "kind" "ContactGroupKind" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_group_members" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_requests" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "targetKind" "FileRequestTargetKind" NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "file_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_request_versions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "dueOffsetDays" INTEGER,
    "allowedContentTypes" TEXT[],
    "maxBytes" INTEGER NOT NULL,
    "replacementPolicy" "FileRequestReplacementPolicy" NOT NULL DEFAULT 'REPLACE_LATEST',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_request_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_request_assignments" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requestVersionId" UUID NOT NULL,
    "contactId" UUID,
    "groupId" UUID,
    "submissionId" UUID,
    "status" "FileRequestAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMPTZ(3),
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "file_request_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_request_files" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "file_request_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_eventId_archivedAt_idx" ON "contacts"("eventId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_eventId_email_key" ON "contacts"("eventId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_eventId_id_key" ON "contacts"("eventId", "id");

-- CreateIndex
CREATE INDEX "contact_groups_eventId_kind_archivedAt_idx" ON "contact_groups"("eventId", "kind", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contact_groups_eventId_slug_key" ON "contact_groups"("eventId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "contact_groups_eventId_id_key" ON "contact_groups"("eventId", "id");

-- CreateIndex
CREATE INDEX "contact_group_members_eventId_contactId_idx" ON "contact_group_members"("eventId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_group_members_groupId_contactId_key" ON "contact_group_members"("groupId", "contactId");

-- CreateIndex
CREATE INDEX "file_requests_eventId_targetKind_archivedAt_idx" ON "file_requests"("eventId", "targetKind", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_requests_eventId_key_key" ON "file_requests"("eventId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "file_requests_eventId_id_key" ON "file_requests"("eventId", "id");

-- CreateIndex
CREATE INDEX "file_request_versions_eventId_createdAt_idx" ON "file_request_versions"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_request_versions_requestId_versionNumber_key" ON "file_request_versions"("requestId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "file_request_versions_eventId_requestId_id_key" ON "file_request_versions"("eventId", "requestId", "id");

-- CreateIndex
CREATE INDEX "file_request_assignments_eventId_status_idx" ON "file_request_assignments"("eventId", "status");

-- CreateIndex
CREATE INDEX "file_request_assignments_requestId_status_idx" ON "file_request_assignments"("requestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "file_request_assignments_eventId_id_key" ON "file_request_assignments"("eventId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "file_request_assignments_requestId_contactId_key" ON "file_request_assignments"("requestId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "file_request_assignments_requestId_groupId_key" ON "file_request_assignments"("requestId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "file_request_assignments_requestId_submissionId_key" ON "file_request_assignments"("requestId", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "file_request_files_objectKey_key" ON "file_request_files"("objectKey");

-- CreateIndex
CREATE INDEX "file_request_files_assignmentId_supersededAt_idx" ON "file_request_files"("assignmentId", "supersededAt");

-- CreateIndex
CREATE INDEX "file_request_files_assignmentId_uploadedAt_idx" ON "file_request_files"("assignmentId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_groups" ADD CONSTRAINT "contact_groups_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_group_members" ADD CONSTRAINT "contact_group_members_eventId_groupId_fkey" FOREIGN KEY ("eventId", "groupId") REFERENCES "contact_groups"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_group_members" ADD CONSTRAINT "contact_group_members_eventId_contactId_fkey" FOREIGN KEY ("eventId", "contactId") REFERENCES "contacts"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_requests" ADD CONSTRAINT "file_requests_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_request_versions" ADD CONSTRAINT "file_request_versions_eventId_requestId_fkey" FOREIGN KEY ("eventId", "requestId") REFERENCES "file_requests"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_request_assignments" ADD CONSTRAINT "file_request_assignments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_request_assignments" ADD CONSTRAINT "file_request_assignments_eventId_requestId_fkey" FOREIGN KEY ("eventId", "requestId") REFERENCES "file_requests"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_request_assignments" ADD CONSTRAINT "file_request_assignments_eventId_requestId_requestVersionI_fkey" FOREIGN KEY ("eventId", "requestId", "requestVersionId") REFERENCES "file_request_versions"("eventId", "requestId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_request_assignments" ADD CONSTRAINT "file_request_assignments_eventId_contactId_fkey" FOREIGN KEY ("eventId", "contactId") REFERENCES "contacts"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_request_assignments" ADD CONSTRAINT "file_request_assignments_eventId_groupId_fkey" FOREIGN KEY ("eventId", "groupId") REFERENCES "contact_groups"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_request_assignments" ADD CONSTRAINT "file_request_assignments_eventId_submissionId_fkey" FOREIGN KEY ("eventId", "submissionId") REFERENCES "cfp_submissions"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_request_files" ADD CONSTRAINT "file_request_files_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "file_request_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

