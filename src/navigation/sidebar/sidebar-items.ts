import {
  CalendarDays,
  ChartNoAxesCombined,
  CircleGauge,
  FileText,
  FormInput,
  type LucideIcon,
  Mail,
  Plug,
  Settings,
  Sparkles,
  UserRoundCheck,
  Users,
} from "lucide-react";

export type NavBadge = "new" | "soon";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

const workspaces = [
  { id: "overview", title: "Overview", icon: CircleGauge },
  { id: "cfp", title: "Call for proposals", icon: FormInput },
  { id: "submissions", title: "Submissions", icon: FileText },
  { id: "speakers", title: "Speakers", icon: Users },
  { id: "onboarding", title: "Onboarding", icon: UserRoundCheck },
  { id: "communications", title: "Communications", icon: Mail },
  { id: "evaluations", title: "Evaluations", icon: ChartNoAxesCombined },
  { id: "agenda", title: "Agenda", icon: CalendarDays },
  { id: "publishing", title: "Publishing", icon: Sparkles },
  { id: "integrations", title: "Integrations", icon: Plug },
  { id: "settings", title: "Event settings", icon: Settings },
] as const;

export type DashboardWorkspace = (typeof workspaces)[number]["id"];

export function isDashboardWorkspace(value: string): value is DashboardWorkspace {
  return workspaces.some(({ id }) => id === value);
}

export function dashboardWorkspaceTitle(workspace: DashboardWorkspace): string {
  return workspaces.find(({ id }) => id === workspace)?.title ?? workspace;
}

export function dashboardEventHref(eventSlug: string, workspace: DashboardWorkspace = "overview"): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/${workspace}`;
}

export function getSidebarItems(eventSlug?: string): NavGroup[] {
  return [
    {
      id: 1,
      label: "Program workspace",
      items: workspaces.map(({ id, title, icon }) => ({
        id,
        title,
        icon,
        url: eventSlug ? dashboardEventHref(eventSlug, id) : "/dashboard",
        disabled: !eventSlug,
      })),
    },
  ];
}
