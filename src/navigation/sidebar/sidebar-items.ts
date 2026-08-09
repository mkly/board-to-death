import {
  CalendarDays,
  ChartNoAxesCombined,
  CircleGauge,
  FileText,
  FileUp,
  FormInput,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  Plug,
  Presentation,
  Settings,
  Sheet,
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
  { id: "dashboards", title: "Custom dashboards", icon: LayoutDashboard },
  { id: "reports", title: "Reports", icon: Sheet },
  { id: "cfp", title: "Call for proposals", icon: FormInput },
  { id: "submissions", title: "Submissions", icon: FileText },
  { id: "sessions", title: "Sessions", icon: Presentation },
  { id: "speakers", title: "Speakers", icon: Users },
  { id: "onboarding", title: "Onboarding", icon: UserRoundCheck },
  { id: "file-requests", title: "File requests", icon: FileUp },
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
  const workspacePath = workspace === "communications" ? "communications/templates" : workspace;
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/${workspacePath}`;
}

export function getSidebarItems(eventSlug?: string): NavGroup[] {
  return [
    {
      id: 1,
      label: "Program workspace",
      items: workspaces.map(({ id, title, icon }): NavMainItem => {
        const url = eventSlug ? dashboardEventHref(eventSlug, id) : "/dashboard";
        const disabled = !eventSlug;
        if (id === "evaluations") {
          return {
            id,
            title,
            icon,
            disabled,
            subItems: [
              { id: "evaluation-rubrics", title: "Rubrics", url, disabled },
              {
                id: "evaluation-assignments",
                title: "Reviewer assignments",
                url: eventSlug ? `${url}/assignments` : "/dashboard",
                disabled,
              },
              {
                id: "evaluation-results",
                title: "Results",
                url: eventSlug ? `${url}/results` : "/dashboard",
                disabled,
              },
            ],
          };
        }

        if (id === "publishing") {
          return {
            id,
            title,
            icon,
            disabled,
            subItems: [
              { id: "publishing-overview", title: "Publishing", url, disabled },
              {
                id: "embed-builder",
                title: "Embed builder",
                url: eventSlug ? `${url}/embeds` : "/dashboard",
                disabled,
              },
            ],
          };
        }

        return { id, title, icon, url, disabled };
      }),
    },
  ];
}
