-- CreateTable
CREATE TABLE "directory_segments" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "directory_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "directory_segments_orgId_name_key" ON "directory_segments"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "directory_segments_orgId_id_key" ON "directory_segments"("orgId", "id");

-- CreateIndex
CREATE INDEX "directory_segments_orgId_createdAt_idx" ON "directory_segments"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "directory_segments" ADD CONSTRAINT "directory_segments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
