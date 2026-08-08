import Link from "next/link";

import { ArrowLeftIcon, CalendarClockIcon, MailIcon, UserRoundIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { CfpSubmissionDetail as SubmissionDetailData } from "@/server/cfp/submissions";

interface SubmissionDetailProps {
  readonly submission: SubmissionDetailData;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function labelForEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function answerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(answerText).join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function speakerName(speaker: SubmissionDetailData["participants"][number]["speaker"]): string {
  return speaker.preferredName ?? `${speaker.givenName} ${speaker.familyName}`;
}

function initials(speaker: SubmissionDetailData["participants"][number]["speaker"]): string {
  return `${speaker.givenName.charAt(0)}${speaker.familyName.charAt(0)}`.toUpperCase();
}

function MetadataItem({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

function ParticipantList({ participants }: { readonly participants: SubmissionDetailData["participants"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Speakers</CardTitle>
        <CardDescription>The primary applicant appears first, followed by co-speakers.</CardDescription>
      </CardHeader>
      <CardContent>
        {participants.length === 0 ? (
          <p className="text-muted-foreground">No speakers are attached to this submission.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {participants.map(({ sortOrder, speaker }, index) => (
              <li key={speaker.id} className="flex min-w-0 items-start gap-3">
                <Avatar size="lg">
                  <AvatarFallback>{initials(speaker)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{speakerName(speaker)}</p>
                    <Badge variant={index === 0 ? "default" : "secondary"}>
                      {index === 0 ? "Applicant" : `Speaker ${sortOrder + 1}`}
                    </Badge>
                  </div>
                  {speaker.preferredName ? (
                    <p className="text-muted-foreground text-sm">
                      {speaker.givenName} {speaker.familyName}
                      {speaker.pronouns ? ` · ${speaker.pronouns}` : ""}
                    </p>
                  ) : null}
                  {!speaker.preferredName && speaker.pronouns ? (
                    <p className="text-muted-foreground text-sm">{speaker.pronouns}</p>
                  ) : null}
                  <a
                    href={`mailto:${speaker.email}`}
                    className="flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
                  >
                    <MailIcon aria-hidden="true" className="size-3.5" />
                    {speaker.email}
                  </a>
                  {speaker.organization || speaker.jobTitle ? (
                    <p className="text-muted-foreground text-sm">
                      {[speaker.jobTitle, speaker.organization].filter(Boolean).join(" at ")}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function AnswerList({ submission }: SubmissionDetailProps) {
  const revision = submission.revision;
  if (!revision) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Responses</CardTitle>
          <CardDescription>This submission does not have a saved response revision.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const questions = new Map(
    revision.definition.sections.flatMap((section) => section.questions.map((question) => [question.id, question])),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Responses</CardTitle>
        <CardDescription>
          {revision.definition.title} · revision {revision.versionNumber}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {revision.answers.length === 0 ? (
          <p className="text-muted-foreground">No question responses were submitted.</p>
        ) : (
          <dl className="flex flex-col gap-5">
            {revision.answers.map((answer, index) => {
              const question = questions.get(answer.questionId);
              return (
                <div key={answer.questionId} className="flex flex-col gap-2">
                  {index > 0 ? <Separator className="mb-3" /> : null}
                  <dt className="font-medium">{question?.label ?? answer.questionId}</dt>
                  {question?.description ? (
                    <dd className="text-muted-foreground text-sm">{question.description}</dd>
                  ) : null}
                  <dd className="whitespace-pre-wrap text-sm leading-relaxed">{answerText(answer.value)}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export function SubmissionDetail({ submission }: SubmissionDetailProps) {
  const submittedAt = submission.submittedAt ?? submission.createdAt;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeftIcon data-icon="inline-start" />
            Dashboard
          </Link>
        </Button>
      </div>

      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{labelForEnum(submission.kind)}</Badge>
            <Badge>{labelForEnum(submission.status)}</Badge>
          </div>
          <div>
            <p className="text-muted-foreground text-sm">{submission.event.name}</p>
            <h1 className="font-heading font-semibold text-2xl tracking-tight md:text-3xl">Submission details</h1>
          </div>
          <p className="break-all text-muted-foreground text-sm">ID {submission.id}</p>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <CalendarClockIcon aria-hidden="true" className="size-4" />
          Submitted {dateFormatter.format(submittedAt)} UTC
        </div>
      </header>

      <Card size="sm">
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetadataItem label="Type" value={labelForEnum(submission.kind)} />
            <MetadataItem label="Decision" value={labelForEnum(submission.status)} />
            <MetadataItem label="Last updated" value={`${dateFormatter.format(submission.updatedAt)} UTC`} />
            <MetadataItem label="Speakers" value={String(submission.participants.length)} />
          </dl>
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <AnswerList submission={submission} />
        <div className="flex min-w-0 flex-col gap-6">
          <ParticipantList participants={submission.participants} />
          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
              <CardDescription>Event-scoped tracks and topics assigned to this proposal.</CardDescription>
            </CardHeader>
            <CardContent>
              {submission.categories.length === 0 ? (
                <p className="text-muted-foreground">No categories assigned.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {submission.categories.map((category) => (
                    <Badge key={category.id} variant="secondary">
                      {category.label}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="flex items-start gap-3">
              <UserRoundIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">
                Speaker order and responses reflect the latest saved submission revision.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
