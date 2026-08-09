import { notFound, redirect } from "next/navigation";

import { PanelsTopLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { dashboardEventHref, dashboardWorkspaceTitle, isDashboardWorkspace } from "@/navigation/sidebar/sidebar-items";
import { EventOverviewRepository } from "@/server/dashboard/overview";
import { getDatabaseClient } from "@/server/database";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { OnboardingWorkspace } from "./_components/onboarding-workspace";
import { OverviewDashboard } from "./_components/overview-dashboard";

export default async function EventWorkspacePage({
  params,
}: {
  readonly params: Promise<{ eventSlug: string; workspace: string }>;
}) {
  const [{ eventSlug, workspace }, shell] = await Promise.all([params, getDashboardShellData()]);

  if (!isDashboardWorkspace(workspace)) {
    notFound();
  }

  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) {
    notFound();
  }

  if (shell.activeEvent?.id !== event.id) {
    redirect(shell.activeEvent ? dashboardEventHref(shell.activeEvent.slug, workspace) : "/dashboard");
  }

  const title = dashboardWorkspaceTitle(workspace);

  if (workspace === "onboarding") {
    return <OnboardingWorkspace event={event} />;
  }

  if (workspace !== "overview") {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        </header>
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PanelsTopLeft />
            </EmptyMedia>
            <EmptyTitle>{title} workspace</EmptyTitle>
            <EmptyDescription>This workspace is ready for its event-scoped tools and data.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const dateFormatter = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: event.timezone,
  });

  const metrics = await new EventOverviewRepository(getDatabaseClient()).get(event.id, event.timezone);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Badge variant="secondary" className="w-fit">
          Active event
        </Badge>
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{event.name}</h1>
          <p className="text-muted-foreground text-sm">
            {dateFormatter.format(event.startsAt)} – {dateFormatter.format(event.endsAt)} · {event.timezone}
          </p>
        </div>
      </header>
      <OverviewDashboard event={event} metrics={metrics} />
    </div>
  );
}
