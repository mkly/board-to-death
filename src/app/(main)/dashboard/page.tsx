import Link from "next/link";
import { redirect } from "next/navigation";

import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";

import { getDashboardShellData } from "./_lib/dashboard-data";

export default async function Page() {
  const { activeEvent, activeOrganization } = await getDashboardShellData();

  if (activeEvent) {
    redirect(dashboardEventHref(activeEvent.slug));
  }

  return (
    <Empty className="min-h-[calc(100svh-var(--dashboard-header-height)-3rem)] border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarDays />
        </EmptyMedia>
        <EmptyTitle>No events yet</EmptyTitle>
        <EmptyDescription>
          {activeOrganization
            ? `Create the first event for ${activeOrganization.name} to start building its workspace.`
            : "Your administrator account does not have an event workspace yet."}
        </EmptyDescription>
      </EmptyHeader>
      {activeOrganization && (
        <EmptyContent>
          <Button asChild>
            <Link href="/dashboard/event-settings?create=1">Create your first event</Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
