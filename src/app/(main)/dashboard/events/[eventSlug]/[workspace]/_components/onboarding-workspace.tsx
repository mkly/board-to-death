import type { ReactNode } from "react";

import { BellOff, ClipboardCheck } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import { SpeakerTaskFileComments } from "@/components/speaker-task-file-comments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Prisma } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerOnboardingRepository } from "@/server/speakers/onboarding";
import { SpeakerTaskReminderRepository } from "@/server/speakers/reminders";

import { commentOnSpeakerTaskFile } from "../actions";
import {
  ApproveTaskButton,
  AssignmentDueDateForm,
  AssignTasksForm,
  ReminderOptOutButton,
  ReminderRuleActivateButton,
  ReminderRuleCancelButton,
  ReminderRuleCreateForm,
  ReminderRuleEditForm,
  RevisionRequestForm,
  WithdrawTaskButton,
} from "./onboarding-forms";

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
        submissions: {
          orderBy: { attemptNumber: "asc" },
          include: { fileComments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
        },
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
  const eligibleReminderSpeakers = new Map(
    reminderCandidates.map((candidate) => [candidate.speakerId, speakerName(candidate.speaker.profileVersions)]),
  );
  const definitionOptions = definitions.flatMap((definition) => {
    const latest = definition.versions.at(-1);
    return latest ? [{ value: definition.id, label: latest.title }] : [];
  });
  const templateOptions = templates.map((template) => ({ value: template.id, label: template.name }));

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

      <AssignTasksForm
        definitionOptions={definitionOptions}
        eventId={event.id}
        eventSlug={event.slug}
        speakers={speakers.map((speaker) => ({ id: speaker.id, name: speakerName(speaker.profileVersions) }))}
      />

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
            <ReminderRuleCreateForm eventSlug={event.slug} templateOptions={templateOptions} />
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
                  const cancelled = rule.cancelledAt !== null;
                  const status = reminderRuleStatus(rule.enabledAt, rule.cancelledAt);
                  return (
                    <TableRow key={rule.id}>
                      <TableCell colSpan={6}>
                        <div className="flex flex-col gap-3">
                          <ReminderRuleEditForm
                            eventSlug={event.slug}
                            rule={{
                              id: rule.id,
                              name: rule.name,
                              templateId: rule.templateId,
                              daysBeforeDue: rule.daysBeforeDue,
                              sendAtValue: minuteValue(rule.sendAtMinute),
                              cancelled,
                            }}
                            templateOptions={templateOptions}
                          />
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
                              <ReminderRuleActivateButton eventSlug={event.slug} ruleId={rule.id} />
                            ) : null}
                            {!cancelled ? <ReminderRuleCancelButton eventSlug={event.slug} ruleId={rule.id} /> : null}
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
                        id: submission.id,
                        attemptNumber: submission.attemptNumber,
                        file: objectValue(submission.response),
                        comments: submission.fileComments,
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
                            <div className="flex flex-col gap-2">
                              <Badge variant={index === 0 ? "secondary" : "outline"}>
                                {index === 0 ? "Latest" : `Version ${fileAttempts.length - index}`}
                              </Badge>
                              <SpeakerTaskFileComments
                                comments={attempt.comments}
                                formAction={commentOnSpeakerTaskFile.bind(null, event.slug, attempt.id)}
                                inputId={`organizer-file-comment-${assignment.id}-${attempt.attemptNumber}`}
                                timezone={event.timezone}
                              />
                            </div>
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
                          <AssignmentDueDateForm
                            assignmentId={assignment.id}
                            defaultValue={dueDateValue(assignment.dueAt, event.timezone)}
                            eventSlug={event.slug}
                            speakerName={name}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {!terminal && (
                          <div className="flex flex-wrap justify-end gap-2">
                            {assignment.status === "SUBMITTED" ? (
                              <>
                                <ApproveTaskButton assignmentId={assignment.id} eventSlug={event.slug} />
                                <RevisionRequestForm
                                  assignmentId={assignment.id}
                                  eventSlug={event.slug}
                                  speakerName={name}
                                />
                              </>
                            ) : null}
                            <ReminderOptOutButton
                              assignmentId={assignment.id}
                              eventSlug={event.slug}
                              optedOut={assignment.remindersOptedOut}
                            />
                            <WithdrawTaskButton
                              assignmentId={assignment.id}
                              eventSlug={event.slug}
                              speakerName={name}
                            />
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
