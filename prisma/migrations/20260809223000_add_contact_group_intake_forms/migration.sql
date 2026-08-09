CREATE TYPE "ContactGroupIntakeFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');
CREATE TYPE "ContactGroupIntakeSubmissionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

CREATE TABLE "contact_group_intake_forms" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "kind" "ContactGroupKind" NOT NULL,
    "publicId" UUID NOT NULL,
    "status" "ContactGroupIntakeFormStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_group_intake_forms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_group_intake_submissions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "formId" UUID NOT NULL,
    "status" "ContactGroupIntakeSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "organizationName" TEXT NOT NULL,
    "organizationSlug" TEXT NOT NULL,
    "contactGivenName" TEXT NOT NULL,
    "contactFamilyName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactJobTitle" TEXT,
    "acceptedGroupId" UUID,
    "acceptedContactId" UUID,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_group_intake_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_group_intake_forms_publicId_key" ON "contact_group_intake_forms"("publicId");
CREATE UNIQUE INDEX "contact_group_intake_forms_eventId_kind_key" ON "contact_group_intake_forms"("eventId", "kind");
CREATE UNIQUE INDEX "contact_group_intake_forms_eventId_id_key" ON "contact_group_intake_forms"("eventId", "id");
CREATE INDEX "contact_group_intake_forms_eventId_status_idx" ON "contact_group_intake_forms"("eventId", "status");
CREATE UNIQUE INDEX "contact_group_intake_submissions_eventId_id_key" ON "contact_group_intake_submissions"("eventId", "id");
CREATE INDEX "contact_group_intake_submissions_eventId_status_createdAt_idx" ON "contact_group_intake_submissions"("eventId", "status", "createdAt");
CREATE INDEX "contact_group_intake_submissions_eventId_organizationSlug_idx" ON "contact_group_intake_submissions"("eventId", "organizationSlug");
CREATE INDEX "contact_group_intake_submissions_reviewedById_idx" ON "contact_group_intake_submissions"("reviewedById");

ALTER TABLE "contact_group_intake_forms"
ADD CONSTRAINT "contact_group_intake_forms_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_group_intake_submissions"
ADD CONSTRAINT "contact_group_intake_submissions_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_group_intake_submissions"
ADD CONSTRAINT "contact_group_intake_submissions_eventId_formId_fkey"
FOREIGN KEY ("eventId", "formId") REFERENCES "contact_group_intake_forms"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_group_intake_submissions"
ADD CONSTRAINT "contact_group_intake_submissions_eventId_acceptedGroupId_fkey"
FOREIGN KEY ("eventId", "acceptedGroupId") REFERENCES "contact_groups"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contact_group_intake_submissions"
ADD CONSTRAINT "contact_group_intake_submissions_eventId_acceptedContactId_fkey"
FOREIGN KEY ("eventId", "acceptedContactId") REFERENCES "contacts"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contact_group_intake_submissions"
ADD CONSTRAINT "contact_group_intake_submissions_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
