CREATE TABLE "contact_group_tiers" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "kind" "ContactGroupKind" NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_group_tiers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "contact_groups" ADD COLUMN "tierId" UUID;
ALTER TABLE "contact_groups" ADD COLUMN "primaryContactId" UUID;

CREATE UNIQUE INDEX "contact_group_tiers_eventId_id_key" ON "contact_group_tiers"("eventId", "id");
CREATE UNIQUE INDEX "contact_group_tiers_eventId_kind_name_key" ON "contact_group_tiers"("eventId", "kind", "name");
CREATE UNIQUE INDEX "contact_group_tiers_eventId_kind_sortOrder_key" ON "contact_group_tiers"("eventId", "kind", "sortOrder");
CREATE INDEX "contact_group_tiers_eventId_kind_sortOrder_idx" ON "contact_group_tiers"("eventId", "kind", "sortOrder");
CREATE INDEX "contact_groups_eventId_tierId_archivedAt_idx" ON "contact_groups"("eventId", "tierId", "archivedAt");
CREATE INDEX "contact_groups_eventId_primaryContactId_idx" ON "contact_groups"("eventId", "primaryContactId");

ALTER TABLE "contact_group_tiers" ADD CONSTRAINT "contact_group_tiers_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_groups" ADD CONSTRAINT "contact_groups_eventId_tierId_fkey" FOREIGN KEY ("eventId", "tierId") REFERENCES "contact_group_tiers"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_groups" ADD CONSTRAINT "contact_groups_eventId_primaryContactId_fkey" FOREIGN KEY ("eventId", "primaryContactId") REFERENCES "contacts"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
