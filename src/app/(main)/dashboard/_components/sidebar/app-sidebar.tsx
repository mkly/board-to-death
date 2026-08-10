"use client";

import Image from "next/image";

import { useShallow } from "zustand/react/shallow";

import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { APP_CONFIG } from "@/config/app-config";
import { cn } from "@/lib/utils";
import { getSidebarItems } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import type { DashboardEvent, DashboardOrganization } from "../../_lib/dashboard-shell";
import { EventSwitcher } from "./event-switcher";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import { OrganizationSwitcher } from "./organization-switcher";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  readonly user: {
    readonly name: string;
    readonly email: string;
    readonly avatar: string;
  };
  readonly events: readonly DashboardEvent[];
  readonly activeEvent: DashboardEvent | null;
  readonly organizations: readonly DashboardOrganization[];
  readonly activeOrganization: DashboardOrganization | null;
}

export function AppSidebar({
  user,
  events,
  activeEvent,
  organizations,
  activeOrganization,
  ...props
}: AppSidebarProps) {
  const { sidebarVariant, sidebarCollapsible, isSynced } = usePreferencesStore(
    useShallow((s) => ({
      sidebarVariant: s.values.sidebar_variant,
      sidebarCollapsible: s.values.sidebar_collapsible,
      isSynced: s.isSynced,
    })),
  );

  const variant = isSynced ? sidebarVariant : props.variant;
  const collapsible = isSynced ? sidebarCollapsible : props.collapsible;

  return (
    <Sidebar
      {...props}
      className={cn("border-sidebar-border/60", props.className)}
      variant={variant}
      collapsible={collapsible}
    >
      <SidebarHeader className="gap-3 border-sidebar-border/60 border-b px-3 py-4">
        <div className="flex items-center gap-2 p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
          <span data-brand-mark className="flex size-8 shrink-0">
            <Image src="/brand-mark.png" alt="" width={64} height={64} priority className="size-full object-contain" />
          </span>
          <span className="font-bold font-heading text-base tracking-tight group-data-[collapsible=icon]:hidden">
            {APP_CONFIG.name}
          </span>
        </div>
        <OrganizationSwitcher organizations={organizations} activeOrganization={activeOrganization} />
        <EventSwitcher events={events} activeEvent={activeEvent} />
      </SidebarHeader>
      <SidebarContent className="py-2">
        <NavMain items={getSidebarItems(activeEvent?.slug, Boolean(activeOrganization))} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
