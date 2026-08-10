import type { ReactNode } from "react";

import { BellOff, BellRing, CalendarClock, Check, ClipboardCheck, RotateCcw, UserPlus, UserX } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import type { Prisma } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerOnboardingRepository } from "@/server/speakers/onboarding";
import { SpeakerTaskReminderRepository } from "@/server/speakers/reminders";

import {
  activateSpeakerTaskReminderRule,
  approveSpeakerTask,
  assignSpeakerTasks,
  cancelSpeakerTaskReminderRule,
  requestSpeakerTaskRevision,
  saveSpeakerTaskReminderRule,
  setSpeakerTaskReminderOptOut,
  updateSpeakerTaskDueDate,
  withdrawSpeakerTask,
} from "../actions";

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

function objectValue(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function dueDateValue(dueAt: Date | null, timezone: string): string {
  if (!dueAt) return "";
  return Temporal.Instant.fromEpochMilliseconds(dueAt.getTime()).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

function minuteValue(sendAtMinute: number): string {
  return `${Math.floor(sendAtMinute / 60)
    .toString()
    .padStart(2, "0")}:${(sendAtMinute % 60).toString().padStart(2, "0")}`;
}

function reminderRuleStatus(enabledAt: Date | null, cancelledAt: Date | null) {
  if (cancelledAt) return { label: "Cancelled", variant: "destructive" as const };
  if (enabledAt) return { label: "Active", variant: "default" as const };
  return { label: "Draft", variant: "secondary" as const };
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
  const reminderRepository = new SpeakerTaskReminderRepository(client);
  const [definitions, speakers, assignments, templates, reminderRules, reminderCandidates] = await Promise.all([
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
        submissions: { orderBy: { attemptNumber: "asc" } },
        transitions: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
      },
      orderBy: [{ assignedAt: "desc" }, { id: "asc" }],
    }),
    client.communicationTemplate.findMany({ where: { eventId: event.id }, orderBy: { name: "asc" } }),
    reminderRepository.list(event.id),
    reminderRepository.previewEligibleAssignments(event.id),
  ]);
  const activeAssignments = assignments.filter(({ status }) => status !== "WITHDRAWN");
  const completedAssignments = assignments.filter(({ status }) => status === "APPROVED");
  const assignAction = assignSpeakerTasks.bind(null, event.slug);
  const eligibleReminderSpeakers = new Map(
    reminderCandidates.map((candidate) => [candidate.speakerId, speakerName(candidate.speaker.profileVersions)]),
  );

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
          <CardTitle>Deadline reminders</CardTitle>
          <CardDescription>
            Schedule email rules by local calendar days before each onboarding deadline. Preview eligibility before
            activation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {templates.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellOff />
                </EmptyMedia>
                <EmptyTitle>No email templates</EmptyTitle>
                <EmptyDescription>Create an event email template before adding a reminder rule.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <form action={saveSpeakerTaskReminderRule.bind(null, event.slug, null)}>
              <FieldGroup className="grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_10rem_10rem_auto] lg:items-end">
                <Field>
                  <FieldLabel htmlFor="new-reminder-name">Rule name</FieldLabel>
                  <Input id="new-reminder-name" name="name" placeholder="One week before" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-reminder-template">Email template</FieldLabel>
                  <NativeSelect id="new-reminder-template" name="templateId" required>
                    {templates.map((template) => (
                      <NativeSelectOption key={template.id} value={template.id}>
                        {template.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-reminder-days">Days before</FieldLabel>
                  <Input
                    id="new-reminder-days"
                    name="daysBeforeDue"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue="7"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-reminder-time">Send time</FieldLabel>
                  <Input id="new-reminder-time" name="sendAt" type="time" defaultValue="09:00" required />
                </Field>
                <Button type="submit" variant="outline">
                  <BellRing data-icon="inline-start" />
                  Add rule
                </Button>
              </FieldGroup>
            </form>
          )}

          {reminderRules.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Eligible now</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reminderRules.map((rule) => {
                  const saveAction = saveSpeakerTaskReminderRule.bind(null, event.slug, rule.id);
                  const activateAction = activateSpeakerTaskReminderRule.bind(null, event.slug, rule.id);
                  const cancelAction = cancelSpeakerTaskReminderRule.bind(null, event.slug, rule.id);
                  const cancelled = rule.cancelledAt !== null;
                  const status = reminderRuleStatus(rule.enabledAt, rule.cancelledAt);
                  return (
                    <TableRow key={rule.id}>
                      <TableCell colSpan={6}>
                        <div className="flex flex-col gap-3">
                          <form
                            action={saveAction}
                            className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_8rem_8rem_auto] lg:items-end"
                          >
                            <Field>
                              <FieldLabel htmlFor={`reminder-name-${rule.id}`} className="sr-only">
                                Rule name
                              </FieldLabel>
                              <Input
                                id={`reminder-name-${rule.id}`}
                                name="name"
                                defaultValue={rule.name}
                                disabled={cancelled}
                                required
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`reminder-template-${rule.id}`} className="sr-only">
                                Email template
                              </FieldLabel>
                              <NativeSelect
                                id={`reminder-template-${rule.id}`}
                                name="templateId"
                                defaultValue={rule.templateId}
                                disabled={cancelled}
                                required
                              >
                                {templates.map((template) => (
                                  <NativeSelectOption key={template.id} value={template.id}>
                                    {template.name}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`reminder-days-${rule.id}`} className="sr-only">
                                Days before
                              </FieldLabel>
                              <Input
                                id={`reminder-days-${rule.id}`}
                                name="daysBeforeDue"
                                type="number"
                                min="0"
                                step="1"
                                defaultValue={rule.daysBeforeDue}
                                disabled={cancelled}
                                required
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`reminder-time-${rule.id}`} className="sr-only">
                                Send time
                              </FieldLabel>
                              <Input
                                id={`reminder-time-${rule.id}`}
                                name="sendAt"
                                type="time"
                                defaultValue={minuteValue(rule.sendAtMinute)}
                                disabled={cancelled}
                                required
                              />
                            </Field>
                            <Button type="submit" size="sm" variant="outline" disabled={cancelled}>
                              Save changes
                            </Button>
                          </form>
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span>
                              {rule.daysBeforeDue} days before at {minuteValue(rule.sendAtMinute)}
                            </span>
                            <span>{rule.template.name}</span>
                            <span title={[...eligibleReminderSpeakers.values()].join(", ")}>
                              {eligibleReminderSpeakers.size} speakers
                            </span>
                            <Badge variant={status.variant}>{status.label}</Badge>
                            {!rule.enabledAt && !cancelled ? (
                              <form action={activateAction}>
                                <Button type="submit" size="sm">
                                  Activate
                                </Button>
                              </form>
                            ) : null}
                            {!cancelled ? (
                              <form action={cancelAction}>
                                <Button type="submit" size="sm" variant="destructive">
                                  Cancel
                                </Button>
                              </form>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

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
                  <TableHead>Response</TableHead>
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
                  const optOutAction = setSpeakerTaskReminderOptOut.bind(
                    null,
                    event.slug,
                    assignment.id,
                    !assignment.remindersOptedOut,
                  );
                  const approveAction = approveSpeakerTask.bind(null, event.slug, assignment.id);
                  const revisionAction = requestSpeakerTaskRevision.bind(null, event.slug, assignment.id);
                  const latestSubmission = assignment.submissions.at(-1);
                  const response = latestSubmission?.response;
                  const responseObject = objectValue(response);
                  let responseContent: ReactNode = <span className="text-muted-foreground">No response</span>;
                  if (typeof response === "string") {
                    responseContent = <p className="max-w-64 whitespace-pre-wrap text-sm">{response}</p>;
                  } else if (responseObject?.approved === true) {
                    responseContent = "Completion confirmed";
                  } else if (typeof responseObject?.objectKey === "string" && latestSubmission) {
                    // Every re-upload is its own attempt and its object is retained, so the
                    // organizer gets the whole version history rather than only the newest file.
                    const fileAttempts = assignment.submissions
                      .map((submission) => ({
                        attemptNumber: submission.attemptNumber,
                        file: objectValue(submission.response),
                      }))
                      .filter((attempt) => typeof attempt.file?.objectKey === "string")
                      .reverse();
                    responseContent = (
                      <ul className="flex flex-col gap-1">
                        {fileAttempts.map((attempt, index) => (
                          <li className="flex flex-wrap items-center gap-2" key={attempt.attemptNumber}>
                            <Button asChild variant="outline" size="sm">
                              <a
                                href={`/dashboard/events/${encodeURIComponent(event.slug)}/onboarding/task-files/${assignment.id}/${attempt.attemptNumber}`}
                              >
                                Download {typeof attempt.file?.fileName === "string" ? attempt.file.fileName : "file"}
                              </a>
                            </Button>
                            <Badge variant={index === 0 ? "secondary" : "outline"}>
                              {index === 0 ? "Latest" : `Version ${fileAttempts.length - index}`}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    );
                  }
                  return (
                    <TableRow key={assignment.id} id={assignment.id} className="scroll-mt-6">
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>{assignment.definitionVersion.title}</TableCell>
                      <TableCell>{taskStatus(assignment.status)}</TableCell>
                      <TableCell>{responseContent}</TableCell>
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
                          <div className="flex flex-wrap justify-end gap-2">
                            {assignment.status === "SUBMITTED" ? (
                              <>
                                <form action={approveAction}>
                                  <Button type="submit" size="sm">
                                    <Check data-icon="inline-start" />
                                    Approve
                                  </Button>
                                </form>
                                <form action={revisionAction} className="flex min-w-64 flex-col gap-2">
                                  <Field>
                                    <FieldLabel htmlFor={`feedback-${assignment.id}`} className="sr-only">
                                      Revision feedback for {name}
                                    </FieldLabel>
                                    <Textarea
                                      id={`feedback-${assignment.id}`}
                                      name="feedback"
                                      placeholder="Explain what needs to change"
                                      rows={2}
                                      required
                                    />
                                  </Field>
                                  <Button type="submit" size="sm" variant="outline" className="self-end">
                                    <RotateCcw data-icon="inline-start" />
                                    Request revision
                                  </Button>
                                </form>
                              </>
                            ) : null}
                            <form action={optOutAction}>
                              <Button type="submit" size="sm" variant="outline">
                                {assignment.remindersOptedOut ? "Resume reminders" : "Pause reminders"}
                              </Button>
                            </form>
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
                          </div>
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
