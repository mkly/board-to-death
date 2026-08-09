import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowLeftIcon, FileTextIcon, UsersRoundIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { Prisma } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { getPortalViewer, portalHref } from "../../../_lib/portal-session";
import { PortalSectionHeading, SubmissionStatus } from "../../_components/portal-content";

interface SpeakerSubmissionPageProps {
  readonly params: Promise<{ readonly eventSlug: string; readonly submissionId: string }>;
}

function answerText(value: Prisma.JsonValue): string {
  if (value === null) return "Not answered";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(answerText).join(", ");
  return JSON.stringify(value);
}

export default async function SpeakerSubmissionPage({ params }: SpeakerSubmissionPageProps) {
  const { eventSlug, submissionId } = await params;
  const viewer = await getPortalViewer(eventSlug);
  const submission = await new SpeakerPortalRepository(getDatabaseClient()).getSubmission(viewer, submissionId);
  if (!submission) notFound();

  return (
    <>
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href={portalHref(eventSlug, "/submissions")}>
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            Back to submissions
          </Link>
        </Button>
      </div>
      <PortalSectionHeading
        icon={FileTextIcon}
        title={submission.title}
        description="Your event submission details and participants."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Submission details</CardTitle>
            <CardDescription>
              {submission.kind === "ABSTRACT" ? "Abstract application" : "Guaranteed session"}
            </CardDescription>
            <div className="pt-2">
              <SubmissionStatus status={submission.status} />
            </div>
          </CardHeader>
          <CardContent>
            {submission.answers.length === 0 ? (
              <p className="text-muted-foreground text-sm">No saved answers are available.</p>
            ) : (
              <dl className="flex flex-col gap-4">
                {submission.answers.map((answer) => (
                  <div key={answer.questionId} className="flex flex-col gap-1">
                    <dt className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      {answer.label}
                    </dt>
                    <dd className="whitespace-pre-wrap text-sm">{answerText(answer.value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Participants</CardTitle>
            <CardDescription>Speakers attached to this proposal.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <UsersRoundIcon className="text-muted-foreground" aria-hidden="true" />
              <Badge variant="secondary">{submission.participants.length} speakers</Badge>
            </div>
            <Separator />
            <ul className="flex flex-col gap-3">
              {submission.participants.map((participant) => (
                <li key={participant.id} className="rounded-lg border p-3">
                  <p className="font-medium">{participant.displayName}</p>
                  {participant.organization ? (
                    <p className="text-muted-foreground text-sm">{participant.organization}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
