CREATE TABLE "speaker_resource_pages" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "speaker_resource_pages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_resource_pages_key" CHECK (length(btrim("key")) > 0)
);

CREATE TABLE "speaker_resource_page_versions" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "bodyMarkdown" TEXT NOT NULL,
    "allowedEmbedUrls" JSONB,
    "sortOrder" INTEGER NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "unpublishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "speaker_resource_page_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_resource_page_versions_positive_version" CHECK ("versionNumber" > 0),
    CONSTRAINT "speaker_resource_page_versions_nonnegative_order" CHECK ("sortOrder" >= 0),
    CONSTRAINT "speaker_resource_page_versions_slug" CHECK (length(btrim("slug")) > 0),
    CONSTRAINT "speaker_resource_page_versions_title" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "speaker_resource_page_versions_lifecycle" CHECK (
        "unpublishedAt" IS NULL OR ("publishedAt" IS NOT NULL AND "unpublishedAt" >= "publishedAt")
    )
);

CREATE UNIQUE INDEX "speaker_resource_pages_eventId_key_key" ON "speaker_resource_pages"("eventId", "key");
CREATE UNIQUE INDEX "speaker_resource_pages_eventId_id_key" ON "speaker_resource_pages"("eventId", "id");
CREATE INDEX "speaker_resource_pages_eventId_archivedAt_idx" ON "speaker_resource_pages"("eventId", "archivedAt");
CREATE UNIQUE INDEX "speaker_resource_page_versions_pageId_versionNumber_key" ON "speaker_resource_page_versions"("pageId", "versionNumber");
CREATE UNIQUE INDEX "speaker_resource_page_versions_eventId_id_key" ON "speaker_resource_page_versions"("eventId", "id");
CREATE INDEX "speaker_resource_page_versions_eventId_sortOrder_idx" ON "speaker_resource_page_versions"("eventId", "sortOrder");
CREATE INDEX "speaker_resource_page_versions_eventId_publishedAt_unpublishedAt_idx" ON "speaker_resource_page_versions"("eventId", "publishedAt", "unpublishedAt");
CREATE UNIQUE INDEX "speaker_resource_page_versions_one_current_per_page" ON "speaker_resource_page_versions"("pageId") WHERE "publishedAt" IS NOT NULL AND "unpublishedAt" IS NULL;
CREATE UNIQUE INDEX "speaker_resource_page_versions_current_event_slug" ON "speaker_resource_page_versions"("eventId", "slug") WHERE "publishedAt" IS NOT NULL AND "unpublishedAt" IS NULL;

ALTER TABLE "speaker_resource_pages"
ADD CONSTRAINT "speaker_resource_pages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "speaker_resource_page_versions"
ADD CONSTRAINT "speaker_resource_page_versions_eventId_pageId_fkey" FOREIGN KEY ("eventId", "pageId") REFERENCES "speaker_resource_pages"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
