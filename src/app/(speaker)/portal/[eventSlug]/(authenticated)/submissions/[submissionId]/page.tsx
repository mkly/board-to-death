import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowLeftIcon, CircleCheckIcon, FileTextIcon, LockKeyholeIcon, UsersRoundIcon } from "lucide-react";

import type { CustomFieldInputDefinition } from "@/components/custom-fields/custom-field-inputs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CustomFieldEntityType, CustomFieldType, type Prisma } from "@/generated/prisma/client";
import { CustomFieldRepository } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { portalHref, requirePortalContent } from "../../../_lib/portal-session";
import { PortalSectionHeading, SubmissionStatus } from "../../_components/portal-content";
import { ApplicantSubmissionEditor } from "./_components/applicant-submission-editor";
import { SubmissionCustomFields } from "./_components/submission-custom-fields";
import { SubmissionParticipantFiles } from "./_components/submission-participant-files";

interface SpeakerSubmissionPageProps {
  readonly params: Promise<{ readonly eventSlug: string; readonly submissionId: string }>;
  readonly searchParams: Promise<{ readonly confirmed?: string }>;
}

function answerText(value: Prisma.JsonValue): string {
  if (value === null) return "Not answered";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(answerText).join(", ");
  return JSON.stringify(value);
}

function inputDefinition(
  field: Awaited<ReturnType<CustomFieldRepository["listDefinitions"]>>[number],
): CustomFieldInputDefinition {
  return {
    id: field.id,
    label: field.label,
    description: field.description,
    type: field.type,
    required: field.required,
    characterLimit: field.characterLimit,
    options:
      Array.isArray(field.options) && field.options.every((option) => typeof option === "string") ? field.options : [],
  };
}

export default async function SpeakerSubmissionPage({ params, searchParams }: SpeakerSubmissionPageProps) {
  const [{ eventSlug, submissionId }, query] = await Promise.all([params, searchParams]);
  const { viewer } = await requirePortalContent(eventSlug, "submissions");
  const client = getDatabaseClient();
  const submission = await new SpeakerPortalRepository(client).getSubmission(viewer, submissionId);
  if (!submission) notFound();
  const customFields = new CustomFieldRepository(client);
  const [definitions, values] = await Promise.all([
    customFields.listDefinitions(viewer.eventId, CustomFieldEntityType.CFP_SUBMISSION),
    customFields.listValues(viewer.eventId, { entityType: "CFP_SUBMISSION", submissionId }),
  ]);
  const editableDefinitions = definitions.filter(({ type }) => type !== CustomFieldType.FILE);

  return (
    <>
      {query.confirmed ? (
        <Alert>
          <CircleCheckIcon />
          <AlertTitle>Participation confirmed</AlertTitle>
          <AlertDescription>
            Your speaker participation is confirmed and applicable onboarding tasks are ready.
          </AlertDescription>
        </Alert>
      ) : null}
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
      {!submission.canEdit ? (
        <Alert>
          <LockKeyholeIcon />
          <AlertTitle>Proposal editing is closed</AlertTitle>
          <AlertDescription>
            The call for proposals is no longer accepting changes. Your saved submission remains available below.
          </AlertDescription>
        </Alert>
      ) : null}
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
                <li key={participant.id} className="flex flex-col gap-3 rounded-lg border p-3">
                  <div>
                    <p className="font-medium">{participant.displayName}</p>
                    {participant.organization ? (
                      <p className="text-muted-foreground text-sm">{participant.organization}</p>
                    ) : null}
                    <Badge className="mt-2" variant={participant.confirmedAt ? "secondary" : "outline"}>
                      {participant.confirmedAt ? "Confirmed" : "Awaiting confirmation"}
                    </Badge>
                  </div>
                  {participant.isSelf ? (
                    <SubmissionParticipantFiles
                      eventSlug={eventSlug}
                      submissionId={submissionId}
                      slidesObjectKey={participant.slidesObjectKey}
                      supportingDocumentObjectKey={participant.supportingDocumentObjectKey}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      {submission.canEdit && submission.definition ? (
        <ApplicantSubmissionEditor
          definition={submission.definition}
          eventSlug={eventSlug}
          initialAnswers={Object.fromEntries(submission.answers.map(({ questionId, value }) => [questionId, value]))}
          submissionId={submissionId}
        />
      ) : null}
      <SubmissionCustomFields
        definitions={editableDefinitions.map(inputDefinition)}
        eventSlug={eventSlug}
        submissionId={submissionId}
        values={values.map(({ definitionId, value }) => ({ definitionId, value }))}
      />
    </>
  );
}
