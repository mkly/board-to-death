CREATE TYPE "CustomDashboardTemplate" AS ENUM (
  'EVENT_OVERVIEW',
  'SUBMISSIONS_PIPELINE',
  'SPEAKER_TRACKING',
  'REVIEW_PROGRESS',
  'EVALUATION_PLANS_BY_TRACK',
  'SCHEDULE_HEALTH',
  'MANUAL'
);

CREATE TYPE "DashboardWidgetKind" AS ENUM ('METRIC', 'CHART', 'LIST');

CREATE TYPE "DashboardWidgetDataSource" AS ENUM (
  'SUBMISSION_TOTAL',
  'SUBMISSIONS_BY_STATUS',
  'RECENT_SUBMISSIONS',
  'SPEAKER_TOTAL',
  'MISSING_BIOGRAPHIES',
  'MISSING_HEADSHOTS',
  'OUTSTANDING_SPEAKER_TASKS',
  'EVALUATION_PROGRESS',
  'EVALUATION_PLANS_BY_TRACK',
  'UNSCHEDULED_SESSIONS'
);

CREATE TABLE "custom_dashboards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "template" "CustomDashboardTemplate" NOT NULL,
  "filters" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "custom_dashboards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dashboard_widgets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "dashboardId" UUID NOT NULL,
  "kind" "DashboardWidgetKind" NOT NULL,
  "dataSource" "DashboardWidgetDataSource" NOT NULL,
  "title" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "settings" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_dashboards_eventId_id_key" ON "custom_dashboards"("eventId", "id");
CREATE INDEX "custom_dashboards_eventId_createdAt_idx" ON "custom_dashboards"("eventId", "createdAt");
CREATE UNIQUE INDEX "dashboard_widgets_dashboardId_position_key" ON "dashboard_widgets"("dashboardId", "position");
CREATE UNIQUE INDEX "dashboard_widgets_eventId_dashboardId_id_key" ON "dashboard_widgets"("eventId", "dashboardId", "id");
CREATE INDEX "dashboard_widgets_eventId_dashboardId_idx" ON "dashboard_widgets"("eventId", "dashboardId");

ALTER TABLE "custom_dashboards"
ADD CONSTRAINT "custom_dashboards_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dashboard_widgets"
ADD CONSTRAINT "dashboard_widgets_eventId_dashboardId_fkey"
FOREIGN KEY ("eventId", "dashboardId") REFERENCES "custom_dashboards"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
