CREATE TABLE "cfp_submission_views" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "sorting" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cfp_submission_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cfp_submission_views_eventId_userId_key" ON "cfp_submission_views"("eventId", "userId");
CREATE INDEX "cfp_submission_views_userId_idx" ON "cfp_submission_views"("userId");

ALTER TABLE "cfp_submission_views"
ADD CONSTRAINT "cfp_submission_views_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cfp_submission_views"
ADD CONSTRAINT "cfp_submission_views_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
