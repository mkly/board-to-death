"use client";

import Image from "next/image";
import Link from "next/link";

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
import { cn } from "@/lib/utils";
import { dashboardEventHref, getSidebarItems } from "@/navigation/sidebar/sidebar-items";
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-auto py-1.5">
              <Link prefetch={false} href={activeEvent ? dashboardEventHref(activeEvent.slug) : "/dashboard"}>
                <span data-brand-mark className="flex size-8 shrink-0 overflow-hidden rounded-lg shadow-xs">
                  <Image
                    src="/brand-mark.png"
                    alt=""
                    width={64}
                    height={64}
                    priority
                    className="size-full object-cover"
                  />
                </span>
                <span className="font-heading font-bold text-base tracking-tight">{APP_CONFIG.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
