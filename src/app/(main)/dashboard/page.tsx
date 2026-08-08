import { redirect } from "next/navigation";

import { CalendarDays } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";

import { getDashboardShellData } from "./_lib/dashboard-data";

export default async function Page() {
  const { activeEvent } = await getDashboardShellData();

  if (activeEvent) {
    redirect(dashboardEventHref(activeEvent.slug));
  }

  return (
    <Empty className="min-h-[calc(100svh-var(--dashboard-header-height)-3rem)] border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarDays />
        </EmptyMedia>
        <EmptyTitle>No events available</EmptyTitle>
        <EmptyDescription>
          Your administrator account does not have an event workspace yet. Ask an owner to create or grant access to an
          event.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
