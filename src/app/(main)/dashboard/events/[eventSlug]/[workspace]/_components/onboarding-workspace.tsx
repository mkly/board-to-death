import { CalendarClock, ClipboardCheck, UserPlus, UserX } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerOnboardingRepository } from "@/server/speakers/onboarding";

import { assignSpeakerTasks, updateSpeakerTaskDueDate, withdrawSpeakerTask } from "../actions";

interface OnboardingWorkspaceProps {
  readonly event: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly timezone: string;
  };
}

function speakerName(
  profileVersions: readonly { givenName: string; familyName: string; preferredName: string | null }[],
) {
  const profile = profileVersions.at(-1);
  if (!profile) return "Unknown speaker";
  return `${profile.preferredName ?? profile.givenName} ${profile.familyName}`;
}

function dueDateValue(dueAt: Date | null, timezone: string): string {
  if (!dueAt) return "";
  return Temporal.Instant.fromEpochMilliseconds(dueAt.getTime()).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

function taskStatus(status: "PENDING" | "SUBMITTED" | "APPROVED" | "REVISION_REQUESTED" | "WITHDRAWN") {
  const labels = {
    PENDING: "Pending",
    SUBMITTED: "Submitted",
    APPROVED: "Approved",
    REVISION_REQUESTED: "Revision requested",
    WITHDRAWN: "Withdrawn",
  } as const;
  const variants = {
    PENDING: "outline",
    SUBMITTED: "secondary",
    APPROVED: "default",
    REVISION_REQUESTED: "secondary",
    WITHDRAWN: "destructive",
  } as const;
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

export async function OnboardingWorkspace({ event }: OnboardingWorkspaceProps) {
  const client = getDatabaseClient();
  const [definitions, speakers, assignments] = await Promise.all([
    new SpeakerOnboardingRepository(client).listDefinitions(event.id),
    client.speaker.findMany({
      where: {
        eventId: event.id,
        submissions: { some: { submission: { eventId: event.id, status: { in: ["ACCEPTED", "CONFIRMED"] } } } },
      },
      include: { profileVersions: { orderBy: { versionNumber: "asc" } } },
      orderBy: { normalizedEmail: "asc" },
    }),
    client.speakerTaskAssignment.findMany({
      where: { eventId: event.id },
      include: {
        definitionVersion: true,
        speaker: { include: { profileVersions: { orderBy: { versionNumber: "asc" } } } },
      },
      orderBy: [{ assignedAt: "desc" }, { id: "asc" }],
    }),
  ]);
  const activeAssignments = assignments.filter(({ status }) => status !== "WITHDRAWN");
  const completedAssignments = assignments.filter(({ status }) => status === "APPROVED");
  const assignAction = assignSpeakerTasks.bind(null, event.slug);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-semibold text-2xl tracking-tight">Speaker onboarding</h1>
        <p className="text-muted-foreground text-sm">
          Assign event tasks, adjust deadlines, and withdraw work that no longer applies.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Eligible speakers</CardTitle>
            <CardDescription>Accepted or confirmed for this event</CardDescription>
          </CardHeader>
          <CardContent className="font-semibold text-2xl">{speakers.length}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Active assignments</CardTitle>
            <CardDescription>Pending, submitted, or approved</CardDescription>
          </CardHeader>
          <CardContent aria-label="Active assignment count" className="font-semibold text-2xl">
            {activeAssignments.length}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Completed</CardTitle>
            <CardDescription>Approved onboarding tasks</CardDescription>
          </CardHeader>
          <CardContent className="font-semibold text-2xl">{completedAssignments.length}</CardContent>
        </Card>
      </div>

      <form action={assignAction}>
        <Card>
          <CardHeader>
            <CardTitle>Assign a task</CardTitle>
            <CardDescription>
              Select one speaker or an accepted-speaker cohort. Existing active assignments are skipped.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {definitions.length === 0 || speakers.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <UserPlus />
                  </EmptyMedia>
                  <EmptyTitle>Nothing to assign yet</EmptyTitle>
                  <EmptyDescription>
                    Add a task definition and accept at least one speaker before assigning onboarding work.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="definitionId">Task</FieldLabel>
                  <NativeSelect id="definitionId" name="definitionId" required className="w-full">
                    {definitions.map((definition) => {
                      const latest = definition.versions.at(-1);
                      return latest ? (
                        <NativeSelectOption key={definition.id} value={definition.id}>
                          {latest.title}
                        </NativeSelectOption>
                      ) : null;
                    })}
                  </NativeSelect>
                  <FieldDescription>The latest definition version is assigned.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="assignmentDueAt">Due date</FieldLabel>
                  <Input id="assignmentDueAt" name="dueAt" type="date" />
                  <FieldDescription>Leave blank to use the task definition&apos;s default deadline.</FieldDescription>
                </Field>
                <FieldSet>
                  <FieldLegend variant="label">Speakers</FieldLegend>
                  <FieldDescription>Select every accepted speaker who should receive this task.</FieldDescription>
                  <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
                    {speakers.map((speaker) => {
                      const name = speakerName(speaker.profileVersions);
                      return (
                        <Field key={speaker.id} orientation="horizontal">
                          <Checkbox id={`speaker-${speaker.id}`} name="speakerIds" value={speaker.id} />
                          <FieldLabel htmlFor={`speaker-${speaker.id}`} className="font-normal">
                            {name}
                          </FieldLabel>
                        </Field>
                      );
                    })}
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={definitions.length === 0 || speakers.length === 0}>
              <UserPlus data-icon="inline-start" />
              Assign selected
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Assignment history</CardTitle>
          <CardDescription>
            Due dates use {event.timezone}. Completed and withdrawn assignments are locked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardCheck />
                </EmptyMedia>
                <EmptyTitle>No assignments yet</EmptyTitle>
                <EmptyDescription>Assigned speaker tasks will appear here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Speaker</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment) => {
                  const name = speakerName(assignment.speaker.profileVersions);
                  const terminal = assignment.status === "APPROVED" || assignment.status === "WITHDRAWN";
                  const terminalDueDate = assignment.dueAt
                    ? dueDateValue(assignment.dueAt, event.timezone)
                    : "No due date";
                  const dueAction = updateSpeakerTaskDueDate.bind(null, event.slug, assignment.id);
                  const withdrawAction = withdrawSpeakerTask.bind(null, event.slug, assignment.id);
                  return (
                    <TableRow key={assignment.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>{assignment.definitionVersion.title}</TableCell>
                      <TableCell>{taskStatus(assignment.status)}</TableCell>
                      <TableCell>
                        {terminal ? (
                          terminalDueDate
                        ) : (
                          <form action={dueAction} className="flex items-center gap-2">
                            <Field>
                              <FieldLabel htmlFor={`due-${assignment.id}`} className="sr-only">
                                Due date for {name}
                              </FieldLabel>
                              <Input
                                id={`due-${assignment.id}`}
                                name="dueAt"
                                type="date"
                                defaultValue={dueDateValue(assignment.dueAt, event.timezone)}
                              />
                            </Field>
                            <Button type="submit" size="sm" variant="outline" aria-label={`Save due date for ${name}`}>
                              <CalendarClock data-icon="inline-start" />
                              Save
                            </Button>
                          </form>
                        )}
                      </TableCell>
                      <TableCell>
                        {!terminal && (
                          <form action={withdrawAction}>
                            <Button
                              type="submit"
                              size="sm"
                              variant="destructive"
                              aria-label={`Withdraw task for ${name}`}
                            >
                              <UserX data-icon="inline-start" />
                              Withdraw
                            </Button>
                          </form>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
