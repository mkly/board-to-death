import { notFound } from "next/navigation";

import { EvaluationPlanVersionStatus } from "@/generated/prisma/client";
import {
  availableDashboardWidgets,
  CustomDashboardRepository,
  dashboardTemplates,
} from "@/server/dashboard/custom-dashboards";
import { EventOverviewRepository } from "@/server/dashboard/overview";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { CustomDashboardWorkspace } from "./_components/custom-dashboard-workspace";

export default async function CustomDashboardsPage({ params }: { readonly params: Promise<{ eventSlug: string }> }) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const [dashboards, metrics, tracks, evaluationPlans] = await Promise.all([
    new CustomDashboardRepository(client).list(event.id),
    new EventOverviewRepository(client).get(event.id, event.timezone),
    client.track.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    client.evaluationPlanVersion.findMany({
      where: { plan: { eventId: event.id }, status: EvaluationPlanVersionStatus.ACTIVE },
      orderBy: [{ activatedAt: "desc" }, { title: "asc" }],
      select: { id: true, title: true, rounds: { orderBy: { sortOrder: "asc" }, select: { id: true, title: true } } },
    }),
  ]);

  return (
    <CustomDashboardWorkspace
      event={{ name: event.name, slug: event.slug }}
      dashboards={dashboards}
      metrics={metrics}
      tracks={tracks.map(({ id, name }) => ({ id, name }))}
      evaluationPlans={evaluationPlans}
      templates={dashboardTemplates.map(({ id, label, description }) => ({ id, label, description }))}
      widgetOptions={availableDashboardWidgets.map(({ dataSource, title, description }) => ({
        dataSource,
        title,
        description,
      }))}
    />
  );
}
