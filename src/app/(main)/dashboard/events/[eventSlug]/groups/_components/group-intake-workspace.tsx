"use client";

import { useActionState, useTransition } from "react";

import Link from "next/link";

import { Check, ExternalLink, Inbox, Send, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ContactGroupIntakeForm, ContactGroupKind } from "@/generated/prisma/client";
import { actionResultToast, useActionToast } from "@/hooks/use-action-toast";
import type { ContactGroupIntakeSubmissionWithDetails } from "@/server/contacts/group-intake";

import {
  closeIntakeFormAction,
  type GroupActionState,
  publishIntakeFormAction,
  reviewIntakeSubmissionAction,
} from "../actions";

interface GroupIntakeWorkspaceProps {
  readonly event: {
    readonly slug: string;
    readonly sponsorsEnabled: boolean;
    readonly exhibitorsEnabled: boolean;
  };
  readonly forms: readonly ContactGroupIntakeForm[];
  readonly submissions: readonly ContactGroupIntakeSubmissionWithDetails[];
}

const KIND_LABELS: Record<ContactGroupKind, string> = { SPONSOR: "Sponsor", EXHIBITOR: "Exhibitor" };
const INITIAL_STATE: GroupActionState = { status: "idle" };

function IntakeFormCard({
  event,
  form,
  kind,
}: Pick<GroupIntakeWorkspaceProps, "event"> & {
  readonly form?: ContactGroupIntakeForm;
  readonly kind: ContactGroupKind;
}) {
  const label = KIND_LABELS[kind];
  const enabled = kind === "SPONSOR" ? event.sponsorsEnabled : event.exhibitorsEnabled;
  const published = form?.status === "PUBLISHED";
  const [state, action, pending] = useActionState(publishIntakeFormAction.bind(null, event.slug, kind), INITIAL_STATE);
  useActionToast(state);
  const [closing, startClosing] = useTransition();
  const close = () => {
    startClosing(async () => {
      actionResultToast(await closeIntakeFormAction(event.slug, kind));
    });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {label} interest form
          <Badge variant={published ? "default" : "secondary"}>
            {published ? "Published" : (form?.status ?? "Draft")}
          </Badge>
        </CardTitle>
        <CardDescription>
          Publish a public form for prospective {label.toLowerCase()} organizations. Responses wait for review.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form noValidate action={action}>
          <FieldGroup>
            <Field data-disabled={!enabled}>
              <FieldLabel htmlFor={`${kind}-intake-title`}>Form title</FieldLabel>
              <Input
                defaultValue={form?.title ?? `${label} interest form`}
                disabled={!enabled}
                id={`${kind}-intake-title`}
                name="title"
                required
              />
            </Field>
            <Field data-disabled={!enabled}>
              <FieldLabel htmlFor={`${kind}-intake-description`}>Introduction</FieldLabel>
              <Input
                defaultValue={form?.description ?? `Tell us about your organization and primary contact.`}
                disabled={!enabled}
                id={`${kind}-intake-description`}
                name="description"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!enabled || pending || closing} type="submit">
                {pending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                {published ? "Update published form" : "Publish form"}
              </Button>
              {published && form ? (
                <>
                  <Button asChild type="button" variant="outline">
                    <Link href={`/partner-intake/${form.publicId}`} target="_blank">
                      <ExternalLink data-icon="inline-start" />
                      Open public form
                    </Link>
                  </Button>
                  <Button disabled={pending || closing} onClick={close} type="button" variant="ghost">
                    {closing ? <Spinner data-icon="inline-start" /> : null}
                    Close form
                  </Button>
                </>
              ) : null}
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function submissionStatusVariant(status: ContactGroupIntakeSubmissionWithDetails["status"]) {
  if (status === "ACCEPTED") return "default" as const;
  if (status === "REJECTED") return "destructive" as const;
  return "secondary" as const;
}

function SubmissionReviewButtons({
  event,
  submissionId,
}: Pick<GroupIntakeWorkspaceProps, "event"> & { readonly submissionId: string }) {
  const [reviewing, startReview] = useTransition();
  const review = (decision: "accept" | "reject") => {
    startReview(async () => {
      actionResultToast(await reviewIntakeSubmissionAction(event.slug, submissionId, decision));
    });
  };
  return (
    <div className="flex justify-end gap-2">
      <Button disabled={reviewing} onClick={() => review("accept")} size="sm" type="button">
        {reviewing ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
        Accept
      </Button>
      <Button disabled={reviewing} onClick={() => review("reject")} size="sm" type="button" variant="outline">
        <X data-icon="inline-start" />
        Reject
      </Button>
    </div>
  );
}

export function GroupIntakeWorkspace({ event, forms, submissions }: GroupIntakeWorkspaceProps) {
  const formByKind = new Map(forms.map((form) => [form.kind, form]));
  return (
    <section aria-labelledby="partner-intake-heading" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="font-heading font-semibold text-xl tracking-tight" id="partner-intake-heading">
          Partner intake
        </h2>
        <p className="text-muted-foreground text-sm">
          Publish interest forms and promote reviewed responses into partner groups and contacts.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <IntakeFormCard event={event} form={formByKind.get("SPONSOR")} kind="SPONSOR" />
        <IntakeFormCard event={event} form={formByKind.get("EXHIBITOR")} kind="EXHIBITOR" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Intake submissions</CardTitle>
          <CardDescription>
            Accepting a response creates or matches the group and assigns its primary contact.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>No intake submissions</EmptyTitle>
                <EmptyDescription>Published form responses will appear here for review.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Primary contact</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{submission.organizationName}</span>
                        <span className="text-muted-foreground text-xs">
                          {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(submission.createdAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>
                          {submission.contactGivenName} {submission.contactFamilyName}
                        </span>
                        <span className="text-muted-foreground text-xs">{submission.contactEmail}</span>
                      </div>
                    </TableCell>
                    <TableCell>{KIND_LABELS[submission.form.kind]}</TableCell>
                    <TableCell>
                      <Badge variant={submissionStatusVariant(submission.status)}>{submission.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {submission.status === "PENDING" ? (
                        <SubmissionReviewButtons event={event} submissionId={submission.id} />
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {submission.acceptedGroup?.name ?? submission.reviewedBy?.name ?? "Reviewed"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
