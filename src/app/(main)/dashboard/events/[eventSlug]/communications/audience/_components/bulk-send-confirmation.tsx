"use client";

import { useActionState } from "react";

import Link from "next/link";

import { MailCheck, Send } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { RecipientAudienceSelection } from "@/server/communications/audiences";

import { type ConfirmBulkCommunicationState, confirmBulkCommunication } from "../actions";

interface BulkSendConfirmationProps {
  readonly eventSlug: string;
  readonly confirmationToken: string;
  readonly recipientCount: number;
  readonly selection: RecipientAudienceSelection;
  readonly templates: readonly { readonly id: string; readonly name: string; readonly version: number }[];
}

const initialState: ConfirmBulkCommunicationState = { status: "idle" };

function SelectionInputs({ selection }: { readonly selection: RecipientAudienceSelection }) {
  return (
    <>
      {selection.speakerIds?.map((value) => (
        <input key={`speaker-${value}`} type="hidden" name="speaker" value={value} />
      ))}
      {selection.sessionIds?.map((value) => (
        <input key={`session-${value}`} type="hidden" name="session" value={value} />
      ))}
      {selection.participantRoles?.map((value) => (
        <input key={`participant-role-${value}`} type="hidden" name="participantRole" value={value} />
      ))}
      {selection.categoryIds?.map((value) => (
        <input key={`category-${value}`} type="hidden" name="category" value={value} />
      ))}
      {selection.acceptanceStatuses?.map((value) => (
        <input key={`acceptance-${value}`} type="hidden" name="acceptance" value={value} />
      ))}
      {selection.onboardingStatuses?.map((value) => (
        <input key={`onboarding-${value}`} type="hidden" name="onboarding" value={value} />
      ))}
      {selection.tierIds?.map((value) => (
        <input key={`tier-${value}`} type="hidden" name="tier" value={value} />
      ))}
    </>
  );
}

export function BulkSendConfirmation({
  eventSlug,
  confirmationToken,
  recipientCount,
  selection,
  templates,
}: BulkSendConfirmationProps) {
  const [state, formAction, pending] = useActionState(confirmBulkCommunication, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm bulk send</CardTitle>
        <CardDescription>
          Confirmation rechecks eligibility and stores the exact template and recipient content before queuing.
        </CardDescription>
      </CardHeader>
      <form id="bulk-send-confirmation" action={formAction}>
        <CardContent>
          <input type="hidden" name="eventSlug" value={eventSlug} />
          <input type="hidden" name="confirmationToken" value={confirmationToken} />
          <SelectionInputs selection={selection} />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="bulk-template">Email template</FieldLabel>
              <Select name="templateId" required>
                <SelectTrigger id="bulk-template" className="w-full">
                  <SelectValue placeholder="Choose a saved template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name} · v{template.version}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                The latest saved version is snapshotted separately for all {recipientCount} eligible recipients.
              </FieldDescription>
            </Field>
          </FieldGroup>
          {state.status !== "idle" && (
            <Alert variant={state.status === "error" ? "destructive" : "default"} className="mt-4">
              <MailCheck />
              <AlertTitle>{state.status === "error" ? "Send not queued" : "Bulk send queued"}</AlertTitle>
              <AlertDescription>
                {state.message}
                {state.deliveryHref && (
                  <>
                    {" "}
                    <Link href={state.deliveryHref}>View delivery details</Link>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          {state.status === "success" ? (
            <Button type="button" variant="outline" disabled>
              <MailCheck data-icon="inline-start" />
              Recipients queued
            </Button>
          ) : templates.length === 0 ? (
            <Button asChild variant="outline">
              <Link href={`/dashboard/events/${encodeURIComponent(eventSlug)}/communications/templates`}>
                Create an email template
              </Link>
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" disabled={pending}>
                  {pending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                  {pending ? "Queuing..." : `Confirm ${recipientCount.toString()} recipients`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogMedia>
                    <Send />
                  </AlertDialogMedia>
                  <AlertDialogTitle>Queue this bulk send?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Current eligibility will be checked again. Later template edits cannot change the queued snapshots.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Go back</AlertDialogCancel>
                  <AlertDialogAction type="submit" form="bulk-send-confirmation">
                    Queue recipient deliveries
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
