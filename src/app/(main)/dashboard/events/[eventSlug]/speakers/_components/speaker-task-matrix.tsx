import Link from "next/link";

import { CalendarClock, Download, Search, UsersRound } from "lucide-react";

import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProgramSessionParticipantRole } from "@/generated/prisma/client";
import type {
  PersistedSpeaker,
  SpeakerTaskMatrixFilters,
  SpeakerTaskMatrixResult,
  SpeakerTaskMatrixState,
} from "@/server/speakers";

import { SpeakerCsvImport } from "./speaker-csv-import";

interface SpeakerTaskMatrixProps {
  readonly event: { readonly name: string; readonly slug: string; readonly timezone: string };
  readonly filters: SpeakerTaskMatrixFilters;
  readonly result: SpeakerTaskMatrixResult;
  readonly roster: readonly PersistedSpeaker[];
}

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>["variant"];

const stateLabels: Readonly<Record<SpeakerTaskMatrixState, string>> = {
  outstanding: "Outstanding",
  overdue: "Overdue",
  complete: "Complete",
  withdrawn: "Withdrawn",
  "not-applicable": "Not applicable",
};

const stateVariants: Readonly<Record<SpeakerTaskMatrixState, BadgeVariant>> = {
  outstanding: "secondary",
  overdue: "destructive",
  complete: "default",
  withdrawn: "outline",
  "not-applicable": "outline",
};

const participantRoleLabels: Readonly<Record<ProgramSessionParticipantRole, string>> = {
  SPEAKER: "Speaker",
  MODERATOR: "Moderator",
  CHAIRPERSON: "Chairperson",
};

function filtersParams(filters: SpeakerTaskMatrixFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.state) params.set("state", filters.state);
  if (filters.taskId) params.set("task", filters.taskId);
  if (filters.speakerId) params.set("speaker", filters.speakerId);
  if (filters.participantRole) params.set("participantRole", filters.participantRole);
  if (filters.dueFrom) params.set("dueFrom", filters.dueFrom);
  if (filters.dueTo) params.set("dueTo", filters.dueTo);
  return params;
}

function eventHref(eventSlug: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/speakers`;
}

function rosterSpeakerName(speaker: PersistedSpeaker): string {
  return `${speaker.profile.preferredName ?? speaker.profile.givenName} ${speaker.profile.familyName}`;
}

function MetricCard({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function SpeakerTaskMatrix({ event, filters, result, roster }: SpeakerTaskMatrixProps) {
  const exportQuery = filtersParams(filters);
  const exportHref = `${eventHref(event.slug)}/export${exportQuery.size > 0 ? `?${exportQuery.toString()}` : ""}`;
  const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: event.timezone });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-semibold text-2xl tracking-tight">Speaker roster</h1>
          <p className="text-muted-foreground text-sm">
            Import and review event speakers, then track every active task in {event.timezone}.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href={exportHref}>
            <Download data-icon="inline-start" />
            Export filtered CSV
          </a>
        </Button>
      </header>

      <SpeakerCsvImport eventSlug={event.slug} />

      <Card>
        <CardHeader>
          <CardTitle>Event speakers</CardTitle>
          <CardDescription>
            {roster.length} {roster.length === 1 ? "speaker" : "speakers"} in this event
          </CardDescription>
        </CardHeader>
        <CardContent>
          {roster.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>No speakers yet</EmptyTitle>
                <EmptyDescription>Import a CSV to start the event roster.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Speaker</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Organization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((speaker) => (
                  <TableRow key={speaker.id}>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        href={`${eventHref(event.slug)}/${speaker.id}`}
                      >
                        {rosterSpeakerName(speaker)}
                      </Link>
                    </TableCell>
                    <TableCell>{speaker.profile.email}</TableCell>
                    <TableCell>{speaker.profile.jobTitle ?? "—"}</TableCell>
                    <TableCell>{speaker.profile.organization ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="task-progress-heading" className="flex flex-col gap-4">
        <div>
          <h2 className="font-semibold text-xl" id="task-progress-heading">
            Task progress
          </h2>
          <p className="text-muted-foreground text-sm">Track active speaker onboarding tasks and due dates.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Outstanding" value={result.counts.outstanding} />
          <MetricCard label="Overdue" value={result.counts.overdue} />
          <MetricCard label="Complete" value={result.counts.complete} />
          <MetricCard label="Withdrawn" value={result.counts.withdrawn} />
          <MetricCard label="Not applicable" value={result.counts["not-applicable"]} />
        </div>
      </section>

      <form action={eventHref(event.slug)} className="rounded-xl border bg-card p-4">
        <FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[minmax(14rem,1fr)_repeat(6,minmax(9rem,0.55fr))_auto]">
          <Field>
            <FieldLabel htmlFor="matrix-search" className="sr-only">
              Search speakers and tasks
            </FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                id="matrix-search"
                name="q"
                defaultValue={filters.search}
                placeholder="Search speaker or task"
              />
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="matrix-state" className="sr-only">
              State
            </FieldLabel>
            <NativeSelect id="matrix-state" name="state" defaultValue={filters.state ?? ""}>
              <NativeSelectOption value="">All states</NativeSelectOption>
              {Object.entries(stateLabels).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="matrix-task" className="sr-only">
              Task
            </FieldLabel>
            <NativeSelect id="matrix-task" name="task" defaultValue={filters.taskId ?? ""}>
              <NativeSelectOption value="">All tasks</NativeSelectOption>
              {result.tasks.map((task) => (
                <NativeSelectOption key={task.id} value={task.id}>
                  {task.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="matrix-speaker" className="sr-only">
              Speaker
            </FieldLabel>
            <NativeSelect id="matrix-speaker" name="speaker" defaultValue={filters.speakerId ?? ""}>
              <NativeSelectOption value="">All speakers</NativeSelectOption>
              {result.speakers.map((speaker) => (
                <NativeSelectOption key={speaker.id} value={speaker.id}>
                  {speaker.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="matrix-participant-role" className="sr-only">
              Program role
            </FieldLabel>
            <NativeSelect
              id="matrix-participant-role"
              name="participantRole"
              defaultValue={filters.participantRole ?? ""}
            >
              <NativeSelectOption value="">All program roles</NativeSelectOption>
              {Object.entries(participantRoleLabels).map(([role, label]) => (
                <NativeSelectOption key={role} value={role}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="matrix-due-from" className="sr-only">
              Due on or after
            </FieldLabel>
            <Input id="matrix-due-from" name="dueFrom" type="date" defaultValue={filters.dueFrom} />
          </Field>
          <Field>
            <FieldLabel htmlFor="matrix-due-to" className="sr-only">
              Due on or before
            </FieldLabel>
            <Input id="matrix-due-to" name="dueTo" type="date" defaultValue={filters.dueTo} />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit">Apply filters</Button>
            <Button asChild type="button" variant="ghost">
              <Link href={eventHref(event.slug)}>Reset</Link>
            </Button>
          </div>
        </FieldGroup>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Task matrix</CardTitle>
          <CardDescription>
            {result.rows.length} matching speaker-task {result.rows.length === 1 ? "record" : "records"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.rows.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>No matching speaker tasks</EmptyTitle>
                <EmptyDescription>Adjust the filters or assign tasks from the Onboarding workspace.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Speaker</TableHead>
                  <TableHead>Program role</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Assignment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        href={`${eventHref(event.slug)}/${row.speakerId}`}
                      >
                        {row.speakerName}
                      </Link>
                      <p className="text-muted-foreground text-xs">{row.speakerEmail}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.participantRoles.length === 0 ? (
                          <span className="text-muted-foreground text-sm">No current session</span>
                        ) : (
                          row.participantRoles.map((role) => (
                            <Badge key={role} variant="outline">
                              {participantRoleLabels[role]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        href={`${eventHref(event.slug)}/tasks/${row.taskId}`}
                      >
                        {row.taskTitle}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={stateVariants[row.state]}>{stateLabels[row.state]}</Badge>
                    </TableCell>
                    <TableCell>{row.dueAt ? dateFormatter.format(row.dueAt) : "—"}</TableCell>
                    <TableCell>
                      {row.assignmentId ? (
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/dashboard/events/${encodeURIComponent(event.slug)}/onboarding#${row.assignmentId}`}
                          >
                            <CalendarClock data-icon="inline-start" />
                            View assignment
                          </Link>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-sm">Not assigned</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
