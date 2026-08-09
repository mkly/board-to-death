import Link from "next/link";

import { CheckCircle2, MailSearch, MailX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CfpSubmissionStatus, SpeakerTaskAssignmentStatus } from "@/generated/prisma/client";
import type {
  RecipientAudienceOptions,
  RecipientAudiencePreview,
  RecipientAudienceSelection,
} from "@/server/communications/audiences";

import { BulkSendConfirmation } from "./bulk-send-confirmation";

interface RecipientAudienceWorkspaceProps {
  readonly event: { readonly id: string; readonly name: string; readonly slug: string };
  readonly options: RecipientAudienceOptions;
  readonly selection: RecipientAudienceSelection;
  readonly preview: RecipientAudiencePreview | null;
  readonly confirmationToken: string;
  readonly templates: readonly { readonly id: string; readonly name: string; readonly version: number }[];
}

const ACCEPTANCE_OPTIONS = [
  [CfpSubmissionStatus.ACCEPTED, "Accepted"],
  [CfpSubmissionStatus.CONFIRMED, "Confirmed"],
  [CfpSubmissionStatus.WAITLISTED, "Waitlisted"],
  [CfpSubmissionStatus.REJECTED, "Rejected"],
] as const;

const ONBOARDING_OPTIONS = [
  [SpeakerTaskAssignmentStatus.PENDING, "Pending"],
  [SpeakerTaskAssignmentStatus.SUBMITTED, "Submitted"],
  [SpeakerTaskAssignmentStatus.REVISION_REQUESTED, "Revision requested"],
  [SpeakerTaskAssignmentStatus.APPROVED, "Approved"],
  [SpeakerTaskAssignmentStatus.WITHDRAWN, "Withdrawn"],
] as const;

function checked(values: readonly string[] | undefined, value: string): boolean {
  return values?.includes(value) ?? false;
}

export function RecipientAudienceWorkspace({
  event,
  options,
  selection,
  preview,
  confirmationToken,
  templates,
}: RecipientAudienceWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Recipient audience</h1>
          <p className="text-muted-foreground text-sm">
            Combine live event cohorts, review exclusions, and verify the exact email audience before sending.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/dashboard/events/${encodeURIComponent(event.slug)}/communications/templates`}>
            Email templates
          </Link>
        </Button>
      </header>

      <form method="get">
        <Card>
          <CardHeader>
            <CardTitle>Choose recipients</CardTitle>
            <CardDescription>
              Criteria are combined with OR. Speakers matching more than one criterion appear only once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-6 lg:grid-cols-2">
              <FieldSet>
                <FieldLegend variant="label">Specific speakers</FieldLegend>
                <FieldDescription>Select individuals regardless of their current program state.</FieldDescription>
                <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
                  {options.speakers.map((speaker) => (
                    <Field key={speaker.id} orientation="horizontal">
                      <Checkbox
                        id={`speaker-${speaker.id}`}
                        name="speaker"
                        value={speaker.id}
                        defaultChecked={checked(selection.speakerIds, speaker.id)}
                      />
                      <FieldLabel htmlFor={`speaker-${speaker.id}`} className="font-normal">
                        {speaker.name}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Acceptance state</FieldLegend>
                <FieldDescription>Match speakers attached to submissions in any selected state.</FieldDescription>
                <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
                  {ACCEPTANCE_OPTIONS.map(([status, label]) => (
                    <Field key={status} orientation="horizontal">
                      <Checkbox
                        id={`acceptance-${status}`}
                        name="acceptance"
                        value={status}
                        defaultChecked={checked(selection.acceptanceStatuses, status)}
                      />
                      <FieldLabel htmlFor={`acceptance-${status}`} className="font-normal">
                        {label}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Sessions</FieldLegend>
                <FieldDescription>Uses only each active session&apos;s current speaker list.</FieldDescription>
                <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
                  {options.sessions.map((session) => (
                    <Field key={session.id} orientation="horizontal">
                      <Checkbox
                        id={`session-${session.id}`}
                        name="session"
                        value={session.id}
                        defaultChecked={checked(selection.sessionIds, session.id)}
                      />
                      <FieldLabel htmlFor={`session-${session.id}`} className="font-normal">
                        {session.title}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Categories</FieldLegend>
                <FieldDescription>Match speakers attached to categorized submissions.</FieldDescription>
                <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
                  {options.categories.map((category) => (
                    <Field key={category.id} orientation="horizontal">
                      <Checkbox
                        id={`category-${category.id}`}
                        name="category"
                        value={category.id}
                        defaultChecked={checked(selection.categoryIds, category.id)}
                      />
                      <FieldLabel htmlFor={`category-${category.id}`} className="font-normal">
                        {category.label}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Onboarding status</FieldLegend>
                <FieldDescription>Match any speaker with an assignment in a selected state.</FieldDescription>
                <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
                  {ONBOARDING_OPTIONS.map(([status, label]) => (
                    <Field key={status} orientation="horizontal">
                      <Checkbox
                        id={`onboarding-${status}`}
                        name="onboarding"
                        value={status}
                        defaultChecked={checked(selection.onboardingStatuses, status)}
                      />
                      <FieldLabel htmlFor={`onboarding-${status}`} className="font-normal">
                        {label}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Sponsor and exhibitor tiers</FieldLegend>
                <FieldDescription>Email each matching group&apos;s designated primary contact.</FieldDescription>
                <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
                  {options.tiers.map((tier) => (
                    <Field key={tier.id} orientation="horizontal">
                      <Checkbox
                        id={`tier-${tier.id}`}
                        name="tier"
                        value={tier.id}
                        defaultChecked={checked(selection.tierIds, tier.id)}
                      />
                      <FieldLabel htmlFor={`tier-${tier.id}`} className="font-normal">
                        {tier.kind === "SPONSOR" ? "Sponsor" : "Exhibitor"} · {tier.label}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button type="submit">
              <MailSearch data-icon="inline-start" />
              Preview audience
            </Button>
            <Button asChild variant="ghost">
              <Link href={`/dashboard/events/${encodeURIComponent(event.slug)}/communications/audience`}>Clear</Link>
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{preview ? `${preview.recipients.length} eligible recipients` : "Audience preview"}</CardTitle>
          <CardDescription>
            {preview
              ? `${preview.excluded.length} matched speakers excluded. Preview again immediately before confirming a send.`
              : "Choose one or more criteria to resolve the current event audience."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!preview || preview.recipients.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MailSearch />
                </EmptyMedia>
                <EmptyTitle>{preview ? "No eligible recipients" : "No preview yet"}</EmptyTitle>
                <EmptyDescription>
                  {preview
                    ? "No currently eligible speaker matches the selected criteria."
                    : "Select a cohort above to see the exact recipients and exclusions."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Matched by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.recipients.map((recipient) => (
                  <TableRow key={recipient.speakerId}>
                    <TableCell className="font-medium">{recipient.displayName}</TableCell>
                    <TableCell>{recipient.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {recipient.matches.map((match) => (
                          <Badge key={`${match.kind}-${match.id}`} variant="outline">
                            {match.label}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {preview && preview.recipients.length > 0 && (
          <CardFooter>
            <Badge>
              <CheckCircle2 />
              Ready for confirmation
            </Badge>
          </CardFooter>
        )}
      </Card>

      {preview && preview.recipients.length > 0 && (
        <BulkSendConfirmation
          eventSlug={event.slug}
          confirmationToken={confirmationToken}
          recipientCount={preview.recipients.length}
          selection={selection}
          templates={templates}
        />
      )}

      {preview && preview.excluded.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Excluded matches</CardTitle>
            <CardDescription>These speakers matched a cohort but cannot currently receive event email.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Speaker</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Matched by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.excluded.map((recipient) => (
                  <TableRow key={recipient.speakerId}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <MailX />
                        {recipient.displayName}
                      </span>
                    </TableCell>
                    <TableCell>{recipient.explanation}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {recipient.matches.map((match) => (
                          <Badge key={`${match.kind}-${match.id}`} variant="outline">
                            {match.label}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
