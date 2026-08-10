import type { ReactNode } from "react";

import Link from "next/link";

import { CalendarClock, ClipboardList, ImageOff, ScrollText, Users } from "lucide-react";

import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { CfpSubmissionStatus } from "@/generated/prisma/client";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import type { EventOverviewMetrics } from "@/server/dashboard/overview";

interface OverviewDashboardProps {
  readonly event: { readonly name: string; readonly slug: string; readonly timezone: string };
  readonly metrics: EventOverviewMetrics;
}

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>["variant"];

const statusLabels: Readonly<Record<CfpSubmissionStatus, string>> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  WAITLISTED: "Waitlisted",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  CONFIRMED: "Confirmed",
};

const statusVariants: Readonly<Record<CfpSubmissionStatus, BadgeVariant>> = {
  DRAFT: "outline",
  SUBMITTED: "secondary",
  UNDER_REVIEW: "default",
  WAITLISTED: "outline",
  ACCEPTED: "default",
  REJECTED: "destructive",
  CONFIRMED: "secondary",
};

function submittedTimeFormatter(timezone: string): Intl.DateTimeFormat {
  // timeZoneName cannot be combined with dateStyle/timeStyle, so the medium-date and
  // short-time fields are spelled out to keep the event's zone label on the timestamp.
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  });
}

function MetricCard({
  label,
  value,
  description,
  href,
}: {
  readonly label: string;
  readonly value: number;
  readonly description: string;
  readonly href: string;
}) {
  return (
    <Link href={href}>
      <Card size="sm" className="h-full transition-colors hover:bg-accent/25">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-xs">{description}</CardContent>
      </Card>
    </Link>
  );
}

function ListCard({
  title,
  description,
  icon,
  emptyMessage,
  items,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: ReactNode;
  readonly emptyMessage: string;
  readonly items: readonly { readonly key: string; readonly href: string; readonly label: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <Empty className="min-h-32 border-0 p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">{icon}</EmptyMedia>
              <EmptyDescription>{emptyMessage}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="text-sm underline-offset-4 hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OverviewDashboard({ event, metrics }: OverviewDashboardProps) {
  const submissionsHref = dashboardEventHref(event.slug, "submissions");
  const speakersHref = dashboardEventHref(event.slug, "speakers");
  const evaluationsHref = `${dashboardEventHref(event.slug, "evaluations")}/assignments`;
  const sessionsHref = dashboardEventHref(event.slug, "sessions");
  const submittedAtFormatter = submittedTimeFormatter(event.timezone);

  const evaluationProgress =
    metrics.evaluations.totalAssignments === 0
      ? 0
      : Math.round((metrics.evaluations.completedAssignments / metrics.evaluations.totalAssignments) * 100);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        <MetricCard
          label="Submissions"
          value={metrics.submissions.total}
          description={`${metrics.submissions.submittedLast7Days} submitted in the last 7 days`}
          href={submissionsHref}
        />
        <MetricCard
          label="Participants"
          value={metrics.participants.total}
          description="Unique speakers in this event"
          href={speakersHref}
        />
        <MetricCard
          label="Outstanding speaker tasks"
          value={metrics.speakerTasks.counts.outstanding}
          description={`${metrics.speakerTasks.counts.overdue} overdue`}
          href={`${speakersHref}?state=outstanding`}
        />
        <MetricCard
          label="Evaluation progress"
          value={evaluationProgress}
          description={`${metrics.evaluations.completedAssignments} of ${metrics.evaluations.totalAssignments} assignments complete`}
          href={evaluationsHref}
        />
        <MetricCard
          label="Missing biographies"
          value={metrics.participants.missingBiography.length}
          description="Speakers without a submitted biography"
          href={speakersHref}
        />
        <MetricCard
          label="Missing headshots"
          value={metrics.participants.missingHeadshot.length}
          description="Speakers without an uploaded headshot"
          href={speakersHref}
        />
        <MetricCard
          label="Overdue speaker tasks"
          value={metrics.speakerTasks.counts.overdue}
          description="Past their due date"
          href={`${speakersHref}?state=overdue`}
        />
        <MetricCard
          label="Unscheduled sessions"
          value={metrics.sessions.unscheduled.length}
          description="Accepted sessions without an agenda placement"
          href={sessionsHref}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent submissions</CardTitle>
            <CardDescription>The 5 most recently submitted proposals</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.submissions.recent.length === 0 ? (
              <Empty className="min-h-32 border-0 p-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ScrollText />
                  </EmptyMedia>
                  <EmptyTitle>No submissions yet</EmptyTitle>
                  <EmptyDescription>Submissions will appear here once the CFP opens.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col gap-3">
                {metrics.submissions.recent.map((submission) => (
                  <li key={submission.id} className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <Link
                        href={`${submissionsHref}/${submission.id}`}
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        {submission.formTitle}
                      </Link>
                      <span className="text-muted-foreground text-xs">
                        {submission.applicantNames.join(", ") || "Not assigned"} ·{" "}
                        {submittedAtFormatter.format(submission.submittedAt)}
                      </span>
                    </div>
                    <Badge variant={statusVariants[submission.status]}>{statusLabels[submission.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submission status breakdown</CardTitle>
            <CardDescription>All submissions for {event.name}</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.submissions.total === 0 ? (
              <Empty className="min-h-32 border-0 p-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ClipboardList />
                  </EmptyMedia>
                  <EmptyDescription>No submissions to summarize yet.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {Object.entries(metrics.submissions.byStatus).map(([status, count]) => (
                  <li key={status} className="flex items-center justify-between gap-3">
                    <Link
                      href={`${submissionsHref}?status=${status}`}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      {statusLabels[status as CfpSubmissionStatus]}
                    </Link>
                    <span className="text-muted-foreground text-sm tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <ListCard
          title="Missing biographies"
          description="Speakers whose profile has no biography"
          icon={<Users />}
          emptyMessage="Every speaker has a biography on file."
          items={metrics.participants.missingBiography.map((speaker) => ({
            key: speaker.id,
            href: `${speakersHref}/${speaker.id}`,
            label: speaker.name,
          }))}
        />

        <ListCard
          title="Missing headshots"
          description="Speakers whose profile has no photo"
          icon={<ImageOff />}
          emptyMessage="Every speaker has a headshot on file."
          items={metrics.participants.missingHeadshot.map((speaker) => ({
            key: speaker.id,
            href: `${speakersHref}/${speaker.id}`,
            label: speaker.name,
          }))}
        />

        <ListCard
          title="Unscheduled accepted sessions"
          description="Accepted sessions with no agenda placement"
          icon={<CalendarClock />}
          emptyMessage="Every accepted session is on the agenda."
          items={metrics.sessions.unscheduled.map((session) => ({
            key: session.id,
            href: `${sessionsHref}?sessionId=${session.id}`,
            label: session.title,
          }))}
        />
      </div>
    </div>
  );
}
