import { notFound, redirect } from "next/navigation";

import { CalendarDays, Clock3, MapPin, PanelsTopLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { dashboardEventHref, dashboardWorkspaceTitle, isDashboardWorkspace } from "@/navigation/sidebar/sidebar-items";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";

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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Badge variant="secondary" className="w-fit">
          Active event
        </Badge>
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{event.name}</h1>
          <p className="text-muted-foreground text-sm">Program administration overview</p>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Dates in the event time zone</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <CalendarDays />
            <span>
              {dateFormatter.format(event.startsAt)} – {dateFormatter.format(event.endsAt)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Time zone</CardTitle>
            <CardDescription>Used for agenda and deadlines</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Clock3 />
            <span>{event.timezone}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>All program tools stay event-scoped</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <MapPin />
            <span>{event.slug}</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
