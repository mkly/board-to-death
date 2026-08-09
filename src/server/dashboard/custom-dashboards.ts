import {
  CustomDashboardTemplate,
  DashboardWidgetDataSource,
  DashboardWidgetKind,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface DashboardWidgetDefinition {
  readonly kind: DashboardWidgetKind;
  readonly dataSource: DashboardWidgetDataSource;
  readonly title: string;
  readonly description: string;
}

export interface DashboardTemplateDefinition {
  readonly id: CustomDashboardTemplate;
  readonly label: string;
  readonly description: string;
  readonly widgets: readonly DashboardWidgetDefinition[];
}

const widgetCatalog = {
  [DashboardWidgetDataSource.SUBMISSION_TOTAL]: {
    kind: DashboardWidgetKind.METRIC,
    dataSource: DashboardWidgetDataSource.SUBMISSION_TOTAL,
    title: "Submissions",
    description: "All proposals received for this event.",
  },
  [DashboardWidgetDataSource.SUBMISSIONS_BY_STATUS]: {
    kind: DashboardWidgetKind.CHART,
    dataSource: DashboardWidgetDataSource.SUBMISSIONS_BY_STATUS,
    title: "Submission pipeline",
    description: "Submission volume by workflow state.",
  },
  [DashboardWidgetDataSource.RECENT_SUBMISSIONS]: {
    kind: DashboardWidgetKind.LIST,
    dataSource: DashboardWidgetDataSource.RECENT_SUBMISSIONS,
    title: "Recent submissions",
    description: "The latest proposals received.",
  },
  [DashboardWidgetDataSource.SPEAKER_TOTAL]: {
    kind: DashboardWidgetKind.METRIC,
    dataSource: DashboardWidgetDataSource.SPEAKER_TOTAL,
    title: "Speakers",
    description: "Unique participants in this event.",
  },
  [DashboardWidgetDataSource.MISSING_BIOGRAPHIES]: {
    kind: DashboardWidgetKind.LIST,
    dataSource: DashboardWidgetDataSource.MISSING_BIOGRAPHIES,
    title: "Missing biographies",
    description: "Speakers whose profile needs a biography.",
  },
  [DashboardWidgetDataSource.MISSING_HEADSHOTS]: {
    kind: DashboardWidgetKind.LIST,
    dataSource: DashboardWidgetDataSource.MISSING_HEADSHOTS,
    title: "Missing headshots",
    description: "Speakers whose profile needs a headshot.",
  },
  [DashboardWidgetDataSource.OUTSTANDING_SPEAKER_TASKS]: {
    kind: DashboardWidgetKind.METRIC,
    dataSource: DashboardWidgetDataSource.OUTSTANDING_SPEAKER_TASKS,
    title: "Outstanding speaker tasks",
    description: "Assigned speaker work that is not complete.",
  },
  [DashboardWidgetDataSource.EVALUATION_PROGRESS]: {
    kind: DashboardWidgetKind.CHART,
    dataSource: DashboardWidgetDataSource.EVALUATION_PROGRESS,
    title: "Review progress",
    description: "Completed and remaining reviewer assignments.",
  },
  [DashboardWidgetDataSource.EVALUATION_PLANS_BY_TRACK]: {
    kind: DashboardWidgetKind.LIST,
    dataSource: DashboardWidgetDataSource.EVALUATION_PLANS_BY_TRACK,
    title: "Evaluation plans by track",
    description: "Active evaluation plans and their review rounds.",
  },
  [DashboardWidgetDataSource.UNSCHEDULED_SESSIONS]: {
    kind: DashboardWidgetKind.LIST,
    dataSource: DashboardWidgetDataSource.UNSCHEDULED_SESSIONS,
    title: "Unscheduled sessions",
    description: "Program sessions that still need an agenda placement.",
  },
} as const satisfies Record<DashboardWidgetDataSource, DashboardWidgetDefinition>;

function widgets(...dataSources: readonly DashboardWidgetDataSource[]): readonly DashboardWidgetDefinition[] {
  return dataSources.map((dataSource) => widgetCatalog[dataSource]);
}

export const dashboardTemplates: readonly DashboardTemplateDefinition[] = [
  {
    id: CustomDashboardTemplate.EVENT_OVERVIEW,
    label: "Event Overview",
    description: "A balanced view of submissions, speakers, reviews, and schedule readiness.",
    widgets: widgets(
      DashboardWidgetDataSource.SUBMISSION_TOTAL,
      DashboardWidgetDataSource.SPEAKER_TOTAL,
      DashboardWidgetDataSource.EVALUATION_PROGRESS,
      DashboardWidgetDataSource.UNSCHEDULED_SESSIONS,
    ),
  },
  {
    id: CustomDashboardTemplate.SUBMISSIONS_PIPELINE,
    label: "Submissions Pipeline",
    description: "Monitor proposal volume, state distribution, and the newest entries.",
    widgets: widgets(
      DashboardWidgetDataSource.SUBMISSION_TOTAL,
      DashboardWidgetDataSource.SUBMISSIONS_BY_STATUS,
      DashboardWidgetDataSource.RECENT_SUBMISSIONS,
    ),
  },
  {
    id: CustomDashboardTemplate.SPEAKER_TRACKING,
    label: "Speaker Tracking",
    description: "Find incomplete profiles and outstanding onboarding work.",
    widgets: widgets(
      DashboardWidgetDataSource.SPEAKER_TOTAL,
      DashboardWidgetDataSource.OUTSTANDING_SPEAKER_TASKS,
      DashboardWidgetDataSource.MISSING_BIOGRAPHIES,
      DashboardWidgetDataSource.MISSING_HEADSHOTS,
    ),
  },
  {
    id: CustomDashboardTemplate.REVIEW_PROGRESS,
    label: "Review Progress",
    description: "Track evaluation completion and active plan structure.",
    widgets: widgets(
      DashboardWidgetDataSource.EVALUATION_PROGRESS,
      DashboardWidgetDataSource.EVALUATION_PLANS_BY_TRACK,
    ),
  },
  {
    id: CustomDashboardTemplate.EVALUATION_PLANS_BY_TRACK,
    label: "Evaluation Plans by Track",
    description: "Focus on activated evaluation plans and their ordered rounds.",
    widgets: widgets(
      DashboardWidgetDataSource.EVALUATION_PLANS_BY_TRACK,
      DashboardWidgetDataSource.EVALUATION_PROGRESS,
    ),
  },
  {
    id: CustomDashboardTemplate.SCHEDULE_HEALTH,
    label: "Schedule Health",
    description: "Surface sessions that are not yet placed on the agenda.",
    widgets: widgets(DashboardWidgetDataSource.UNSCHEDULED_SESSIONS),
  },
  {
    id: CustomDashboardTemplate.MANUAL,
    label: "Blank dashboard",
    description: "Start empty and add only the widgets your team needs.",
    widgets: [],
  },
];

export const availableDashboardWidgets = Object.values(widgetCatalog);

export interface DashboardFilters {
  readonly trackId?: string;
}

function templateDefinition(template: CustomDashboardTemplate): DashboardTemplateDefinition {
  const definition = dashboardTemplates.find(({ id }) => id === template);
  if (!definition) throw new RepositoryError("invalid-input", "The selected dashboard template is not supported.");
  return definition;
}

function normalizedName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new RepositoryError("invalid-input", "Dashboard names must be between 1 and 100 characters.");
  }
  return normalized;
}

async function requireDashboard(client: PrismaClient | Prisma.TransactionClient, eventId: string, dashboardId: string) {
  const dashboard = await client.customDashboard.findFirst({ where: { id: dashboardId, eventId } });
  if (!dashboard) throw new RepositoryError("not-found", "This dashboard is not available for the event.");
  return dashboard;
}

export class CustomDashboardRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  list(eventId: string) {
    return this.client.customDashboard.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { widgets: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
  }

  async create(eventId: string, input: { readonly name: string; readonly template: CustomDashboardTemplate }) {
    const template = templateDefinition(input.template);
    return this.client.customDashboard.create({
      data: {
        eventId,
        name: normalizedName(input.name),
        template: input.template,
        filters: {},
        widgets: {
          create: template.widgets.map((widget, position) => ({
            kind: widget.kind,
            dataSource: widget.dataSource,
            title: widget.title,
            position,
            settings: { width: widget.kind === DashboardWidgetKind.METRIC ? "compact" : "wide" },
          })),
        },
      },
      include: { widgets: { orderBy: { position: "asc" } } },
    });
  }

  async rename(eventId: string, dashboardId: string, name: string) {
    await requireDashboard(this.client, eventId, dashboardId);
    return this.client.customDashboard.update({ where: { id: dashboardId }, data: { name: normalizedName(name) } });
  }

  async setFilters(eventId: string, dashboardId: string, filters: DashboardFilters) {
    await requireDashboard(this.client, eventId, dashboardId);
    if (filters.trackId) {
      const track = await this.client.track.findFirst({
        where: { id: filters.trackId, eventId },
        select: { id: true },
      });
      if (!track) throw new RepositoryError("not-found", "This track is not available for the event.");
    }
    return this.client.customDashboard.update({
      where: { id: dashboardId },
      data: { filters: filters as Prisma.InputJsonValue },
    });
  }

  async addWidget(eventId: string, dashboardId: string, dataSource: DashboardWidgetDataSource) {
    const definition = widgetCatalog[dataSource];
    if (!definition) throw new RepositoryError("invalid-input", "The selected widget is not supported.");
    return this.client.$transaction(async (transaction) => {
      await requireDashboard(transaction, eventId, dashboardId);
      const last = await transaction.dashboardWidget.aggregate({ where: { dashboardId }, _max: { position: true } });
      return transaction.dashboardWidget.create({
        data: {
          eventId,
          dashboardId,
          kind: definition.kind,
          dataSource,
          title: definition.title,
          position: (last._max.position ?? -1) + 1,
          settings: { width: definition.kind === DashboardWidgetKind.METRIC ? "compact" : "wide" },
        },
      });
    });
  }

  async configureWidget(
    eventId: string,
    dashboardId: string,
    widgetId: string,
    input: { readonly title: string; readonly width: "compact" | "wide" },
  ) {
    await requireDashboard(this.client, eventId, dashboardId);
    const title = normalizedName(input.title);
    const result = await this.client.dashboardWidget.updateMany({
      where: { id: widgetId, eventId, dashboardId },
      data: { title, settings: { width: input.width } },
    });
    if (result.count === 0) throw new RepositoryError("not-found", "This widget is not available for the dashboard.");
  }

  async moveWidget(eventId: string, dashboardId: string, widgetId: string, direction: "up" | "down") {
    return this.client.$transaction(async (transaction) => {
      await requireDashboard(transaction, eventId, dashboardId);
      const ordered = await transaction.dashboardWidget.findMany({
        where: { eventId, dashboardId },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      const index = ordered.findIndex(({ id }) => id === widgetId);
      if (index < 0) throw new RepositoryError("not-found", "This widget is not available for the dashboard.");
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= ordered.length) return;
      [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
      await transaction.dashboardWidget.updateMany({ where: { dashboardId }, data: { position: { increment: 1000 } } });
      await Promise.all(
        ordered.map(({ id }, position) => transaction.dashboardWidget.update({ where: { id }, data: { position } })),
      );
    });
  }

  async removeWidget(eventId: string, dashboardId: string, widgetId: string) {
    return this.client.$transaction(async (transaction) => {
      await requireDashboard(transaction, eventId, dashboardId);
      const removed = await transaction.dashboardWidget.deleteMany({ where: { id: widgetId, eventId, dashboardId } });
      if (removed.count === 0)
        throw new RepositoryError("not-found", "This widget is not available for the dashboard.");
      const remaining = await transaction.dashboardWidget.findMany({
        where: { dashboardId },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      await transaction.dashboardWidget.updateMany({ where: { dashboardId }, data: { position: { increment: 1000 } } });
      await Promise.all(
        remaining.map(({ id }, position) => transaction.dashboardWidget.update({ where: { id }, data: { position } })),
      );
    });
  }

  async delete(eventId: string, dashboardId: string) {
    const result = await this.client.customDashboard.deleteMany({ where: { id: dashboardId, eventId } });
    if (result.count === 0) throw new RepositoryError("not-found", "This dashboard is not available for the event.");
  }
}
