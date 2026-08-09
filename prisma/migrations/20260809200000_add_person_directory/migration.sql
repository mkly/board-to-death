-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "givenName" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "organization" TEXT,
    "jobTitle" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "personId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "people_email_key" ON "people"("email");

-- CreateIndex
CREATE INDEX "people_familyName_givenName_idx" ON "people"("familyName", "givenName");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_eventId_personId_key" ON "contacts"("eventId", "personId");

-- CreateIndex
CREATE INDEX "contacts_personId_idx" ON "contacts"("personId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
