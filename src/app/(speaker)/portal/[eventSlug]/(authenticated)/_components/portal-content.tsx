import Link from "next/link";

import {
  BookOpenIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  type CircleUserRoundIcon,
  ClipboardCheckIcon,
  FileTextIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import type { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { portalHref } from "../../_lib/portal-session";

export type SpeakerPortalDashboard = NonNullable<Awaited<ReturnType<SpeakerPortalRepository["getDashboard"]>>>;
export type SpeakerPortalSubmission = SpeakerPortalDashboard["submissions"][number];

const statusLabels = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  WAITLISTED: "Waitlisted",
  ACCEPTED: "Accepted",
  REJECTED: "Not accepted",
  CONFIRMED: "Confirmed",
} as const;

const taskStatusLabels = {
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REVISION_REQUESTED: "Changes requested",
  WITHDRAWN: "Withdrawn",
} as const;

function statusVariant(status: SpeakerPortalSubmission["status"]) {
  if (status === "REJECTED") return "destructive" as const;
  if (status === "ACCEPTED" || status === "CONFIRMED") return "default" as const;
  if (status === "DRAFT" || status === "WAITLISTED") return "outline" as const;
  return "secondary" as const;
}

export function SubmissionStatus({ status }: { readonly status: SpeakerPortalSubmission["status"] }) {
  return <Badge variant={statusVariant(status)}>{statusLabels[status]}</Badge>;
}

function EmptySection({
  description,
  icon: Icon,
  title,
}: {
  readonly description: string;
  readonly icon: typeof FileTextIcon;
  readonly title: string;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function SubmissionList({
  eventSlug,
  submissions,
}: {
  readonly eventSlug: string;
  readonly submissions: readonly SpeakerPortalSubmission[];
}) {
  if (submissions.length === 0) {
    return (
      <EmptySection
        icon={FileTextIcon}
        title="No submissions yet"
        description="Your submitted proposals will appear here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {submissions.map((submission) => (
        <li key={submission.id}>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{submission.title}</CardTitle>
              <CardDescription>{submission.kind === "ABSTRACT" ? "Abstract" : "Guaranteed session"}</CardDescription>
              <CardAction>
                <SubmissionStatus status={submission.status} />
              </CardAction>
            </CardHeader>
            <CardFooterLink href={portalHref(eventSlug, `/submissions/${submission.id}`)} label="View submission" />
          </Card>
        </li>
      ))}
    </ul>
  );
}

function CardFooterLink({ href, label }: { readonly href: string; readonly label: string }) {
  return (
    <CardFooter>
      <Button asChild variant="outline" size="sm">
        <Link href={href}>{label}</Link>
      </Button>
    </CardFooter>
  );
}

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: timezone }).format(date);
}

function formatDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
}

export function PortalDashboard({ dashboard }: { readonly dashboard: SpeakerPortalDashboard }) {
  const { event, profile, resources, sessions, submissions, tasks } = dashboard;
  const accepted = submissions.filter(({ status }) => status === "ACCEPTED" || status === "CONFIRMED").length;
  const openTasks = tasks.filter(({ status }) => status !== "APPROVED").length;

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight sm:text-3xl">
          Welcome, {profile.preferredName ?? profile.givenName}
        </h1>
        <p className="max-w-2xl text-muted-foreground text-sm">
          Track your proposals, speaking schedule, onboarding work, and event resources in one place.
        </p>
      </div>

      <section aria-label="Portal summary" className="grid gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>My submissions</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{submissions.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Accepted or confirmed</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{accepted}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Tasks needing attention</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{openTasks}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <section aria-labelledby="submissions-heading">
          <Card>
            <CardHeader>
              <CardTitle id="submissions-heading">My submissions</CardTitle>
              <CardDescription>Application status and acceptance decisions for this event.</CardDescription>
              <CardAction>
                <Button asChild variant="outline" size="sm">
                  <Link href={portalHref(event.slug, "/submissions")}>View all</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <SubmissionList eventSlug={event.slug} submissions={submissions.slice(0, 3)} />
            </CardContent>
          </Card>
        </section>

        <section id="profile" aria-labelledby="profile-heading" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <CardTitle id="profile-heading">My profile</CardTitle>
              <CardDescription>Contact and public speaker details on file.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <p className="font-medium">{profile.displayName}</p>
                <p className="text-muted-foreground text-sm">{profile.email}</p>
              </div>
              <Separator />
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Organization</dt>
                  <dd>{profile.organization ?? "Not provided"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Role</dt>
                  <dd>{profile.jobTitle ?? "Not provided"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Biography</dt>
                  <dd className="line-clamp-4">{profile.biography ?? "Not provided"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </section>
      </div>

      <section id="tasks" aria-labelledby="tasks-heading" className="scroll-mt-6">
        <Card>
          <CardHeader>
            <CardTitle id="tasks-heading">Onboarding tasks</CardTitle>
            <CardDescription>Work assigned to you by the event team.</CardDescription>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <EmptySection
                icon={ClipboardCheckIcon}
                title="You are all caught up"
                description="No onboarding tasks are assigned to you."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{task.definitionVersion.title}</p>
                      <p className="text-muted-foreground text-sm">
                        {task.dueAt ? `Due ${formatDate(task.dueAt, event.timezone)}` : "No due date"}
                      </p>
                    </div>
                    <Badge variant={task.status === "APPROVED" ? "default" : "secondary"}>
                      {taskStatusLabels[task.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="sessions-heading">
          <Card className="h-full">
            <CardHeader>
              <CardTitle id="sessions-heading">My sessions</CardTitle>
              <CardDescription>Confirmed program sessions and schedule details.</CardDescription>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <EmptySection
                  icon={CalendarDaysIcon}
                  title="No sessions scheduled"
                  description="Accepted sessions will appear when the program is ready."
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {sessions.map((session) => (
                    <li key={session.id} className="rounded-lg border p-4">
                      <p className="font-medium">{session.title}</p>
                      <p className="mt-1 text-muted-foreground text-sm">
                        {session.agendaPlacement
                          ? `${formatDateTime(session.agendaPlacement.startsAt, event.timezone)} · ${session.agendaPlacement.room.name}`
                          : `${session.durationMinutes} minutes · Schedule pending`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        <section id="resources" aria-labelledby="resources-heading" className="scroll-mt-6">
          <Card className="h-full">
            <CardHeader>
              <CardTitle id="resources-heading">Resources</CardTitle>
              <CardDescription>Published guidance from the event team.</CardDescription>
            </CardHeader>
            <CardContent>
              {resources.length === 0 ? (
                <EmptySection
                  icon={BookOpenIcon}
                  title="No resources published"
                  description="Event guidance and speaker materials will appear here."
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {resources.map((resource) => (
                    <li key={resource.id} className="rounded-lg border p-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle2Icon className="mt-0.5 text-muted-foreground" aria-hidden="true" />
                        <div>
                          <p className="font-medium">{resource.title}</p>
                          {resource.summary ? (
                            <p className="mt-1 text-muted-foreground text-sm">{resource.summary}</p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}

export function PortalSectionHeading({
  description,
  icon: Icon,
  title,
}: {
  readonly description: string;
  readonly icon: typeof CircleUserRoundIcon;
  readonly title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
        <Icon aria-hidden="true" />
      </div>
      <div>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  );
}

export { EmptySection, formatDate, SubmissionList };
