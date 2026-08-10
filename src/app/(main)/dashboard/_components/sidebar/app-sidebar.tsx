"use client";

import Link from "next/link";

import { Command } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { APP_CONFIG } from "@/config/app-config";
import { dashboardEventHref, getSidebarItems } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import type { DashboardEvent, DashboardOrganization } from "../../_lib/dashboard-shell";
import { EventSwitcher } from "./event-switcher";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import { OrganizationSwitcher } from "./organization-switcher";
import { SupportCard } from "./support-card";

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
    <Sidebar {...props} variant={variant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link prefetch={false} href={activeEvent ? dashboardEventHref(activeEvent.slug) : "/dashboard"}>
                <Command />
                <span className="font-semibold text-base">{APP_CONFIG.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <OrganizationSwitcher organizations={organizations} activeOrganization={activeOrganization} />
        <EventSwitcher events={events} activeEvent={activeEvent} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={getSidebarItems(activeEvent?.slug)} />
      </SidebarContent>
      <SidebarFooter>
        <SupportCard />
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
