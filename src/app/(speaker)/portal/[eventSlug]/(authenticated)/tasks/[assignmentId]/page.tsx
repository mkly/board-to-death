import Link from "next/link";
import { notFound } from "next/navigation";

import { AlertCircleIcon, ArrowLeftIcon, CheckCircle2Icon, Clock3Icon, FileTextIcon } from "lucide-react";

import { SpeakerTaskFileComments } from "@/components/speaker-task-file-comments";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { Prisma } from "@/generated/prisma/client";
import { parsePortalFormDefinition } from "@/lib/portal-forms";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";
import { speakerTaskResponseKind } from "@/server/speakers";

import { portalHref, requirePortalContent } from "../../../_lib/portal-session";
import { TaskResponseForm } from "./_components/task-response-form";
import { commentOnSpeakerTaskFile, saveTaskResponse, submitSpeakerTask } from "./actions";

interface SpeakerTaskPageProps {
  readonly params: Promise<{ readonly assignmentId: string; readonly eventSlug: string }>;
}

const statusLabels = {
  APPROVED: "Approved",
  PENDING: "Pending",
  REVISION_REQUESTED: "Changes requested",
  SUBMITTED: "Submitted",
  WITHDRAWN: "Withdrawn",
} as const;

function objectValue(value: Prisma.JsonValue | null): Prisma.JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: timezone }).format(date);
}

export default async function SpeakerTaskPage({ params }: SpeakerTaskPageProps) {
  const { assignmentId, eventSlug } = await params;
  const { viewer, portal } = await requirePortalContent(eventSlug, "tasks");
  const repository = new SpeakerPortalRepository(getDatabaseClient());
  const [task, dashboard] = await Promise.all([
    repository.getTask(viewer, assignmentId),
    repository.getDashboard(viewer),
  ]);
  if (!task || !dashboard) notFound();
  if (!portal.contentVisibility.forms && parsePortalFormDefinition(task.definitionVersion.responseSchema)) notFound();

  const kind = speakerTaskResponseKind(task.definitionVersion.responseRequired, task.definitionVersion.responseSchema);
  const open = task.status === "PENDING" || task.status === "REVISION_REQUESTED";
  const overdue = open && task.dueAt !== null && task.dueAt < new Date();
  const latestSubmission = task.submissions.at(-1);
  const latestResponse = latestSubmission?.response ?? null;
  const latestFeedback =
    task.status === "REVISION_REQUESTED"
      ? task.transitions.findLast(({ note, toStatus }) => toStatus === "REVISION_REQUESTED" && Boolean(note))?.note
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href={portalHref(eventSlug, "#tasks")}>
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          Back to tasks
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{dashboard.event.name}</p>
          <h1 className="font-heading font-semibold text-2xl tracking-tight sm:text-3xl">
            {task.definitionVersion.title}
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            {task.definitionVersion.description ?? "Complete this task for the event team."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={task.status === "APPROVED" ? "default" : "secondary"}>{statusLabels[task.status]}</Badge>
          {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
        </div>
      </div>

      {latestFeedback ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>Changes requested</AlertTitle>
          <AlertDescription>{latestFeedback}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>{open ? "Complete this task" : "Submission status"}</CardTitle>
            <CardDescription>
              {open ? "Your response is saved as a new attempt when you submit." : "Your latest response is read-only."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {open ? (
              <TaskResponseForm
                action={submitSpeakerTask.bind(null, eventSlug, assignmentId)}
                kind={kind}
                defaultText={typeof latestResponse === "string" ? latestResponse : undefined}
                formAction={saveTaskResponse.bind(null, eventSlug, assignmentId)}
                formDefinition={task.form ?? undefined}
                formAnswers={task.answers}
              />
            ) : (
              <Alert>
                <CheckCircle2Icon aria-hidden="true" />
                <AlertTitle>{task.status === "APPROVED" ? "Task approved" : "Awaiting event-team review"}</AlertTitle>
                <AlertDescription>
                  {task.status === "APPROVED"
                    ? "The event team approved your submitted response."
                    : "You can submit another attempt only if the event team requests changes."}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Task details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="flex items-start gap-2">
              <Clock3Icon aria-hidden="true" />
              <div>
                <p className="font-medium">Due date</p>
                <p className="text-muted-foreground">
                  {task.dueAt ? formatDate(task.dueAt, dashboard.event.timezone) : "No due date"}
                </p>
              </div>
            </div>
            <Separator />
            <div>
              <p className="font-medium">Response history</p>
              <p className="text-muted-foreground">
                {task.submissions.length} {task.submissions.length === 1 ? "attempt" : "attempts"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {task.submissions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Previous attempts</CardTitle>
            <CardDescription>Earlier responses remain available after a revision request.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              {task.submissions.map((submission) => {
                const response = submission.response;
                const value = objectValue(response);
                return (
                  <li key={submission.attemptNumber} className="flex flex-col gap-2 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">Attempt {submission.attemptNumber}</p>
                      <p className="text-muted-foreground text-sm">
                        {formatDate(submission.submittedAt, dashboard.event.timezone)}
                      </p>
                    </div>
                    {typeof response === "string" ? <p className="whitespace-pre-wrap text-sm">{response}</p> : null}
                    {value?.approved === true ? <p className="text-sm">Completion confirmed.</p> : null}
                    {typeof value?.objectKey === "string" ? (
                      <div className="flex flex-col gap-3">
                        <Button asChild variant="outline" size="sm" className="w-fit">
                          <a href={portalHref(eventSlug, `/tasks/${assignmentId}/files/${submission.attemptNumber}`)}>
                            <FileTextIcon data-icon="inline-start" aria-hidden="true" />
                            {typeof value.fileName === "string" ? value.fileName : "Download response file"}
                          </a>
                        </Button>
                        <SpeakerTaskFileComments
                          comments={submission.fileComments}
                          formAction={commentOnSpeakerTaskFile.bind(null, eventSlug, assignmentId, submission.id)}
                          inputId={`speaker-file-comment-${submission.id}`}
                          timezone={dashboard.event.timezone}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
