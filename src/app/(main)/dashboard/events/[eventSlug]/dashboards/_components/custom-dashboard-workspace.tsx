"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { ArrowDown, ArrowUp, ChartNoAxesCombined, LayoutDashboard, Plus, Settings2, Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { CfpSubmissionStatus, DashboardWidgetDataSource, DashboardWidgetKind } from "@/generated/prisma/client";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import type { EventOverviewMetrics } from "@/server/dashboard/overview";

import { type DashboardMutationState, mutateDashboard } from "../actions";

interface DashboardWidgetRecord {
  readonly id: string;
  readonly kind: DashboardWidgetKind;
  readonly dataSource: DashboardWidgetDataSource;
  readonly title: string;
  readonly position: number;
  readonly settings: unknown;
}

interface DashboardRecord {
  readonly id: string;
  readonly name: string;
  readonly template: string;
  readonly filters: unknown;
  readonly widgets: readonly DashboardWidgetRecord[];
}

interface TemplateOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

interface WidgetOption {
  readonly dataSource: DashboardWidgetDataSource;
  readonly title: string;
  readonly description: string;
}

interface CustomDashboardWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly dashboards: readonly DashboardRecord[];
  readonly metrics: EventOverviewMetrics;
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
  readonly evaluationPlans: readonly {
    readonly id: string;
    readonly title: string;
    readonly rounds: readonly { readonly id: string; readonly title: string }[];
  }[];
  readonly templates: readonly TemplateOption[];
  readonly widgetOptions: readonly WidgetOption[];
}

const INITIAL_STATE: DashboardMutationState = { status: "idle" };

const submissionStatusLabels: Readonly<Record<CfpSubmissionStatus, string>> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  WAITLISTED: "Waitlisted",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  CONFIRMED: "Confirmed",
};

const chartConfig = {
  count: { label: "Count", color: "var(--chart-3)" },
} satisfies ChartConfig;

function fieldError(state: DashboardMutationState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function dashboardTrackId(filters: unknown): string {
  if (!filters || typeof filters !== "object" || !("trackId" in filters)) return "all";
  return typeof filters.trackId === "string" ? filters.trackId : "all";
}

function widgetWidth(settings: unknown): "compact" | "wide" {
  if (settings && typeof settings === "object" && "width" in settings && settings.width === "compact") {
    return "compact";
  }
  return "wide";
}

function HiddenMutationFields({
  eventSlug,
  dashboardId,
  intent,
}: {
  readonly eventSlug: string;
  readonly dashboardId: string;
  readonly intent: string;
}) {
  return (
    <>
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );
}

function CreateDashboardDialog({
  eventSlug,
  templates,
  action,
  pending,
  state,
}: {
  readonly eventSlug: string;
  readonly templates: readonly TemplateOption[];
  readonly action: (payload: FormData) => void;
  readonly pending: boolean;
  readonly state: DashboardMutationState;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          New dashboard
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form noValidate action={action}>
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="eventSlug" value={eventSlug} />
          <DialogHeader>
            <DialogTitle>Create dashboard</DialogTitle>
            <DialogDescription>Choose a proven starting point or begin with an empty canvas.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field data-invalid={Boolean(fieldError(state, "name")) || undefined}>
              <FieldLabel htmlFor="dashboard-name">Name</FieldLabel>
              <Input id="dashboard-name" name="name" placeholder="Program operations" required />
              <FieldError>{fieldError(state, "name")}</FieldError>
            </Field>
            <Field data-invalid={Boolean(fieldError(state, "template")) || undefined}>
              <FieldLabel htmlFor="dashboard-template">Template</FieldLabel>
              <Select name="template" defaultValue={templates[0]?.id}>
                <SelectTrigger id="dashboard-template">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>The widget set can be changed after creation.</FieldDescription>
              <FieldError>{fieldError(state, "template")}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <LayoutDashboard data-icon="inline-start" />}
              {pending ? "Creating..." : "Create dashboard"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DashboardSettingsDialog({
  eventSlug,
  dashboard,
  tracks,
  action,
  pending,
  state,
}: {
  readonly eventSlug: string;
  readonly dashboard: DashboardRecord;
  readonly tracks: CustomDashboardWorkspaceProps["tracks"];
  readonly action: (payload: FormData) => void;
  readonly pending: boolean;
  readonly state: DashboardMutationState;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 data-icon="inline-start" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dashboard settings</DialogTitle>
          <DialogDescription>Update the name and persistent event filters.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          <form noValidate action={action}>
            <HiddenMutationFields eventSlug={eventSlug} dashboardId={dashboard.id} intent="rename" />
            <FieldGroup>
              <Field data-invalid={Boolean(fieldError(state, "name")) || undefined}>
                <FieldLabel htmlFor="rename-dashboard">Dashboard name</FieldLabel>
                <Input id="rename-dashboard" name="name" defaultValue={dashboard.name} required />
                <FieldError>{fieldError(state, "name")}</FieldError>
              </Field>
              <Button type="submit" variant="outline" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Save name
              </Button>
            </FieldGroup>
          </form>
          <form noValidate action={action}>
            <HiddenMutationFields eventSlug={eventSlug} dashboardId={dashboard.id} intent="filter" />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="dashboard-track">Track filter</FieldLabel>
                <Select name="trackId" defaultValue={dashboardTrackId(dashboard.filters)}>
                  <SelectTrigger id="dashboard-track">
                    <SelectValue placeholder="All tracks" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      <SelectItem value="all">All tracks</SelectItem>
                      {tracks.map((track) => (
                        <SelectItem key={track.id} value={track.id}>
                          {track.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Saved with this dashboard and applied where a widget supports tracks.
                </FieldDescription>
              </Field>
              <Button type="submit" variant="outline" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Save filter
              </Button>
            </FieldGroup>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddWidgetDialog({
  eventSlug,
  dashboardId,
  widgetOptions,
  action,
  pending,
  state,
}: {
  readonly eventSlug: string;
  readonly dashboardId: string;
  readonly widgetOptions: readonly WidgetOption[];
  readonly action: (payload: FormData) => void;
  readonly pending: boolean;
  readonly state: DashboardMutationState;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus data-icon="inline-start" />
          Add widget
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form noValidate action={action}>
          <HiddenMutationFields eventSlug={eventSlug} dashboardId={dashboardId} intent="add-widget" />
          <DialogHeader>
            <DialogTitle>Add widget</DialogTitle>
            <DialogDescription>
              Widgets use an allowlisted event data source; custom queries are not accepted.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field>
              <FieldLabel htmlFor="widget-source">Widget</FieldLabel>
              <Select name="dataSource" defaultValue={widgetOptions[0]?.dataSource}>
                <SelectTrigger id="widget-source">
                  <SelectValue placeholder="Select a widget" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    {widgetOptions.map((widget) => (
                      <SelectItem key={widget.dataSource} value={widget.dataSource}>
                        {widget.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              Add widget
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WidgetSettingsDialog({
  eventSlug,
  dashboardId,
  widget,
  action,
  pending,
}: {
  readonly eventSlug: string;
  readonly dashboardId: string;
  readonly widget: DashboardWidgetRecord;
  readonly action: (payload: FormData) => void;
  readonly pending: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Configure ${widget.title}`}>
          <Settings2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form noValidate action={action}>
          <HiddenMutationFields eventSlug={eventSlug} dashboardId={dashboardId} intent="configure-widget" />
          <input type="hidden" name="widgetId" value={widget.id} />
          <DialogHeader>
            <DialogTitle>Configure widget</DialogTitle>
            <DialogDescription>Change presentation without changing the allowlisted data source.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field>
              <FieldLabel htmlFor={`widget-title-${widget.id}`}>Title</FieldLabel>
              <Input id={`widget-title-${widget.id}`} name="title" defaultValue={widget.title} required />
            </Field>
            <Field>
              <FieldLabel htmlFor={`widget-width-${widget.id}`}>Width</FieldLabel>
              <Select name="width" defaultValue={widgetWidth(widget.settings)}>
                <SelectTrigger id={`widget-width-${widget.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="compact">Compact</SelectItem>
                    <SelectItem value="wide">Wide</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save widget
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WidgetActions({
  eventSlug,
  dashboardId,
  widget,
  index,
  count,
  action,
  pending,
}: {
  readonly eventSlug: string;
  readonly dashboardId: string;
  readonly widget: DashboardWidgetRecord;
  readonly index: number;
  readonly count: number;
  readonly action: (payload: FormData) => void;
  readonly pending: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <form noValidate action={action}>
        <HiddenMutationFields eventSlug={eventSlug} dashboardId={dashboardId} intent="move-widget" />
        <input type="hidden" name="widgetId" value={widget.id} />
        <input type="hidden" name="direction" value="up" />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={pending || index === 0}
          aria-label="Move widget up"
        >
          <ArrowUp />
        </Button>
      </form>
      <form noValidate action={action}>
        <HiddenMutationFields eventSlug={eventSlug} dashboardId={dashboardId} intent="move-widget" />
        <input type="hidden" name="widgetId" value={widget.id} />
        <input type="hidden" name="direction" value="down" />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={pending || index === count - 1}
          aria-label="Move widget down"
        >
          <ArrowDown />
        </Button>
      </form>
      <WidgetSettingsDialog
        eventSlug={eventSlug}
        dashboardId={dashboardId}
        widget={widget}
        action={action}
        pending={pending}
      />
      <form noValidate action={action}>
        <HiddenMutationFields eventSlug={eventSlug} dashboardId={dashboardId} intent="remove-widget" />
        <input type="hidden" name="widgetId" value={widget.id} />
        <Button type="submit" variant="ghost" size="icon-sm" disabled={pending} aria-label={`Remove ${widget.title}`}>
          <Trash2 />
        </Button>
      </form>
    </div>
  );
}

function MetricWidget({
  dataSource,
  metrics,
}: {
  readonly dataSource: DashboardWidgetDataSource;
  readonly metrics: EventOverviewMetrics;
}) {
  let value = 0;
  let detail = "Current event total";
  if (dataSource === "SUBMISSION_TOTAL") value = metrics.submissions.total;
  else if (dataSource === "SPEAKER_TOTAL") value = metrics.participants.total;
  else if (dataSource === "OUTSTANDING_SPEAKER_TASKS") {
    value = metrics.speakerTasks.counts.outstanding;
    detail = `${metrics.speakerTasks.counts.overdue} overdue`;
  }
  return (
    <div className="flex flex-col gap-1">
      <strong className="font-semibold text-3xl tabular-nums">{value}</strong>
      <span className="text-muted-foreground text-xs">{detail}</span>
    </div>
  );
}

function ChartWidget({
  dataSource,
  metrics,
}: {
  readonly dataSource: DashboardWidgetDataSource;
  readonly metrics: EventOverviewMetrics;
}) {
  const data =
    dataSource === "SUBMISSIONS_BY_STATUS"
      ? Object.entries(metrics.submissions.byStatus).map(([status, count]) => ({
          label: submissionStatusLabels[status as CfpSubmissionStatus],
          count,
        }))
      : [
          { label: "Complete", count: metrics.evaluations.completedAssignments },
          {
            label: "Remaining",
            count: metrics.evaluations.totalAssignments - metrics.evaluations.completedAssignments,
          },
        ];
  if (data.every(({ count }) => count === 0)) {
    return <p className="text-muted-foreground text-sm">No data is available for this chart yet.</p>;
  }
  return (
    <ChartContainer config={chartConfig} className="h-56 w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={6} />
      </BarChart>
    </ChartContainer>
  );
}

function ListWidget({
  dataSource,
  eventSlug,
  metrics,
  evaluationPlans,
  trackId,
}: {
  readonly dataSource: DashboardWidgetDataSource;
  readonly eventSlug: string;
  readonly metrics: EventOverviewMetrics;
  readonly evaluationPlans: CustomDashboardWorkspaceProps["evaluationPlans"];
  readonly trackId?: string;
}) {
  const submissionsHref = dashboardEventHref(eventSlug, "submissions");
  const speakersHref = dashboardEventHref(eventSlug, "speakers");
  const sessionsHref = dashboardEventHref(eventSlug, "sessions");
  let items: readonly {
    readonly id: string;
    readonly label: string;
    readonly detail?: string;
    readonly href: string;
  }[] = [];
  if (dataSource === "RECENT_SUBMISSIONS") {
    items = metrics.submissions.recent.map((submission) => ({
      id: submission.id,
      label: submission.formTitle,
      detail: submission.applicantNames.join(", ") || "No participant",
      href: `${submissionsHref}/${submission.id}`,
    }));
  } else if (dataSource === "MISSING_BIOGRAPHIES") {
    items = metrics.participants.missingBiography.map((speaker) => ({
      id: speaker.id,
      label: speaker.name,
      href: `${speakersHref}/${speaker.id}`,
    }));
  } else if (dataSource === "MISSING_HEADSHOTS") {
    items = metrics.participants.missingHeadshot.map((speaker) => ({
      id: speaker.id,
      label: speaker.name,
      href: `${speakersHref}/${speaker.id}`,
    }));
  } else if (dataSource === "UNSCHEDULED_SESSIONS") {
    items = metrics.sessions.unscheduled
      .filter((session) => !trackId || session.trackId === trackId)
      .map((session) => ({
        id: session.id,
        label: session.title,
        href: `${sessionsHref}?sessionId=${session.id}`,
      }));
  } else if (dataSource === "EVALUATION_PLANS_BY_TRACK") {
    items = evaluationPlans.map((plan) => ({
      id: plan.id,
      label: plan.title,
      detail: `${plan.rounds.length} review ${plan.rounds.length === 1 ? "round" : "rounds"}`,
      href: dashboardEventHref(eventSlug, "evaluations"),
    }));
  }
  if (items.length === 0) return <p className="text-muted-foreground text-sm">Nothing needs attention here.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.slice(0, 8).map((item) => (
        <li key={item.id} className="flex items-start justify-between gap-3">
          <Link href={item.href} className="text-sm underline-offset-4 hover:underline">
            {item.label}
          </Link>
          {item.detail ? <span className="text-muted-foreground text-xs">{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function DashboardWidgetCard({
  eventSlug,
  dashboardId,
  widget,
  index,
  count,
  metrics,
  evaluationPlans,
  trackId,
  action,
  pending,
}: {
  readonly eventSlug: string;
  readonly dashboardId: string;
  readonly widget: DashboardWidgetRecord;
  readonly index: number;
  readonly count: number;
  readonly metrics: EventOverviewMetrics;
  readonly evaluationPlans: CustomDashboardWorkspaceProps["evaluationPlans"];
  readonly trackId?: string;
  readonly action: (payload: FormData) => void;
  readonly pending: boolean;
}) {
  return (
    <Card className={widgetWidth(widget.settings) === "wide" ? "md:col-span-2" : undefined}>
      <CardHeader>
        <CardTitle>{widget.title}</CardTitle>
        <CardDescription>{widget.dataSource.toLowerCase().replaceAll("_", " ")}</CardDescription>
        <CardAction>
          <WidgetActions
            eventSlug={eventSlug}
            dashboardId={dashboardId}
            widget={widget}
            index={index}
            count={count}
            action={action}
            pending={pending}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {widget.kind === "METRIC" ? <MetricWidget dataSource={widget.dataSource} metrics={metrics} /> : null}
        {widget.kind === "CHART" ? <ChartWidget dataSource={widget.dataSource} metrics={metrics} /> : null}
        {widget.kind === "LIST" ? (
          <ListWidget
            dataSource={widget.dataSource}
            eventSlug={eventSlug}
            metrics={metrics}
            evaluationPlans={evaluationPlans}
            trackId={trackId}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CustomDashboardWorkspace({
  event,
  dashboards,
  metrics,
  tracks,
  evaluationPlans,
  templates,
  widgetOptions,
}: CustomDashboardWorkspaceProps) {
  const [state, action, pending] = useActionState(mutateDashboard, INITIAL_STATE);
  const [selectedId, setSelectedId] = useState(dashboards[0]?.id ?? "");
  const activeDashboard = useMemo(
    () => dashboards.find(({ id }) => id === selectedId) ?? dashboards[0] ?? null,
    [dashboards, selectedId],
  );

  useEffect(() => {
    if (state.status === "success" && state.dashboardId && dashboards.some(({ id }) => id === state.dashboardId)) {
      setSelectedId(state.dashboardId);
    } else if (selectedId !== "" && !dashboards.some(({ id }) => id === selectedId)) {
      setSelectedId(dashboards[0]?.id ?? "");
    }
  }, [dashboards, selectedId, state]);

  const selectedTrack = activeDashboard
    ? tracks.find(({ id }) => id === dashboardTrackId(activeDashboard.filters))
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-semibold text-2xl tracking-tight">Custom dashboards</h1>
          <p className="text-muted-foreground text-sm">
            Build focused operational views from safe, event-scoped widgets.
          </p>
        </div>
        <CreateDashboardDialog
          eventSlug={event.slug}
          templates={templates}
          action={action}
          pending={pending}
          state={state}
        />
      </header>

      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {dashboards.length === 0 ? (
        <Empty className="min-h-96 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesCombined />
            </EmptyMedia>
            <EmptyTitle>No custom dashboards yet</EmptyTitle>
            <EmptyDescription>
              Start from an operational template or build a dashboard one widget at a time.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <CreateDashboardDialog
              eventSlug={event.slug}
              templates={templates}
              action={action}
              pending={pending}
              state={state}
            />
          </EmptyContent>
        </Empty>
      ) : null}

      {activeDashboard ? (
        <>
          <Card size="sm">
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <Field className="w-full sm:max-w-sm">
                <FieldLabel htmlFor="dashboard-selector">Dashboard</FieldLabel>
                <Select value={activeDashboard.id} onValueChange={setSelectedId}>
                  <SelectTrigger id="dashboard-selector">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {dashboards.map((dashboard) => (
                        <SelectItem key={dashboard.id} value={dashboard.id}>
                          {dashboard.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                {selectedTrack ? <Badge variant="secondary">Track: {selectedTrack.name}</Badge> : null}
                <DashboardSettingsDialog
                  eventSlug={event.slug}
                  dashboard={activeDashboard}
                  tracks={tracks}
                  action={action}
                  pending={pending}
                  state={state}
                />
                <AddWidgetDialog
                  eventSlug={event.slug}
                  dashboardId={activeDashboard.id}
                  widgetOptions={widgetOptions}
                  action={action}
                  pending={pending}
                  state={state}
                />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {activeDashboard.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes the dashboard and its widget layout. Event records and source data are not changed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <form noValidate action={action}>
                        <HiddenMutationFields eventSlug={event.slug} dashboardId={activeDashboard.id} intent="delete" />
                        <AlertDialogAction type="submit" disabled={pending}>
                          Delete dashboard
                        </AlertDialogAction>
                      </form>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>

          {activeDashboard.widgets.length === 0 ? (
            <Empty className="min-h-72 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LayoutDashboard />
                </EmptyMedia>
                <EmptyTitle>This dashboard is empty</EmptyTitle>
                <EmptyDescription>Add an allowlisted metric, chart, or list widget to begin.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <AddWidgetDialog
                  eventSlug={event.slug}
                  dashboardId={activeDashboard.id}
                  widgetOptions={widgetOptions}
                  action={action}
                  pending={pending}
                  state={state}
                />
              </EmptyContent>
            </Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {activeDashboard.widgets.map((widget, index) => (
                <DashboardWidgetCard
                  key={widget.id}
                  eventSlug={event.slug}
                  dashboardId={activeDashboard.id}
                  widget={widget}
                  index={index}
                  count={activeDashboard.widgets.length}
                  metrics={metrics}
                  evaluationPlans={evaluationPlans}
                  trackId={selectedTrack?.id}
                  action={action}
                  pending={pending}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
