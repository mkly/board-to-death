ALTER TABLE "cfp_policies"
ADD COLUMN "publishedFormVersionId" UUID;

CREATE INDEX "cfp_policies_publishedFormVersionId_idx"
ON "cfp_policies"("publishedFormVersionId");

ALTER TABLE "cfp_policies"
ADD CONSTRAINT "cfp_policies_publishedFormVersionId_fkey"
FOREIGN KEY ("publishedFormVersionId") REFERENCES "cfp_form_versions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
