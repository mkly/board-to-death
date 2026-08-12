"use client";

import { useActionState, useTransition } from "react";

import Link from "next/link";

import { BellRing, CalendarClock, Check, RotateCcw, UserPlus, UserX } from "lucide-react";

import { DatePicker } from "@/components/date-time-picker";
import { FormSelect, type FormSelectOption } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { actionResultToast, useActionToast } from "@/hooks/use-action-toast";

import {
  activateSpeakerTaskReminderRule,
  approveSpeakerTask,
  assignSpeakerTasks,
  cancelSpeakerTaskReminderRule,
  type OnboardingActionState,
  requestSpeakerTaskRevision,
  saveSpeakerTaskReminderRule,
  setSpeakerTaskReminderOptOut,
  updateSpeakerTaskDueDate,
  withdrawSpeakerTask,
} from "../actions";

const INITIAL_STATE: OnboardingActionState = { status: "idle" };

export function AssignTasksForm({
  definitionOptions,
  eventId,
  eventSlug,
  speakers,
}: {
  readonly definitionOptions: readonly FormSelectOption[];
  readonly eventId: string;
  readonly eventSlug: string;
  readonly speakers: readonly { readonly id: string; readonly name: string }[];
}) {
  const [state, formAction, pending] = useActionState(assignSpeakerTasks.bind(null, eventSlug), INITIAL_STATE);
  useActionToast(state);
  const nothingToAssign = definitionOptions.length === 0 || speakers.length === 0;

  return (
    <form noValidate action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Assign a task</CardTitle>
          <CardDescription>
            Select one speaker or an accepted-speaker cohort. Existing active assignments are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nothingToAssign ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UserPlus />
                </EmptyMedia>
                <EmptyTitle>Nothing to assign yet</EmptyTitle>
                <EmptyDescription>
                  <Link href={`/dashboard/onboarding-tasks?event=${eventId}&create=1`}>Add a task definition</Link> and
                  accept at least one speaker before assigning onboarding work.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="definitionId">Task</FieldLabel>
                <FormSelect
                  id="definitionId"
                  name="definitionId"
                  required
                  className="w-full"
                  options={definitionOptions}
                />
                <FieldDescription>The latest definition version is assigned.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="assignmentDueAt">Due date</FieldLabel>
                <DatePicker id="assignmentDueAt" name="dueAt" />
                <FieldDescription>Leave blank to use the task definition&apos;s default deadline.</FieldDescription>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Speakers</FieldLegend>
                <FieldDescription>Select every accepted speaker who should receive this task.</FieldDescription>
                <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
                  {speakers.map((speaker) => (
                    <Field key={speaker.id} orientation="horizontal">
                      <Checkbox id={`speaker-${speaker.id}`} name="speakerIds" value={speaker.id} />
                      <FieldLabel htmlFor={`speaker-${speaker.id}`} className="font-normal">
                        {speaker.name}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={nothingToAssign || pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" />}
            {pending ? "Assigning…" : "Assign selected"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function ReminderRuleCreateForm({
  eventSlug,
  templateOptions,
}: {
  readonly eventSlug: string;
  readonly templateOptions: readonly FormSelectOption[];
}) {
  const [state, formAction, pending] = useActionState(
    saveSpeakerTaskReminderRule.bind(null, eventSlug, null),
    INITIAL_STATE,
  );
  useActionToast(state);

  return (
    <form noValidate action={formAction}>
      <FieldGroup className="grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_10rem_10rem_auto] lg:items-end">
        <Field>
          <FieldLabel htmlFor="new-reminder-name">Rule name</FieldLabel>
          <Input id="new-reminder-name" name="name" placeholder="One week before" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-reminder-template">Email template</FieldLabel>
          <FormSelect id="new-reminder-template" name="templateId" required options={templateOptions} />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-reminder-days">Days before</FieldLabel>
          <Input id="new-reminder-days" name="daysBeforeDue" type="number" min="0" step="1" defaultValue="7" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-reminder-time">Send time</FieldLabel>
          <Input id="new-reminder-time" name="sendAt" type="time" defaultValue="09:00" required />
        </Field>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : <BellRing data-icon="inline-start" />}
          {pending ? "Adding…" : "Add rule"}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function ReminderRuleEditForm({
  eventSlug,
  rule,
  templateOptions,
}: {
  readonly eventSlug: string;
  readonly rule: {
    readonly id: string;
    readonly name: string;
    readonly templateId: string;
    readonly daysBeforeDue: number;
    readonly sendAtValue: string;
    readonly cancelled: boolean;
  };
  readonly templateOptions: readonly FormSelectOption[];
}) {
  const [state, formAction, pending] = useActionState(
    saveSpeakerTaskReminderRule.bind(null, eventSlug, rule.id),
    INITIAL_STATE,
  );
  useActionToast(state);

  return (
    <form
      noValidate
      action={formAction}
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
          disabled={rule.cancelled}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`reminder-template-${rule.id}`} className="sr-only">
          Email template
        </FieldLabel>
        <FormSelect
          id={`reminder-template-${rule.id}`}
          name="templateId"
          defaultValue={rule.templateId}
          disabled={rule.cancelled}
          required
          options={templateOptions}
        />
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
          disabled={rule.cancelled}
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
          defaultValue={rule.sendAtValue}
          disabled={rule.cancelled}
          required
        />
      </Field>
      <Button type="submit" size="sm" variant="outline" disabled={rule.cancelled || pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

export function ReminderRuleActivateButton({
  eventSlug,
  ruleId,
}: {
  readonly eventSlug: string;
  readonly ruleId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          actionResultToast(await activateSpeakerTaskReminderRule(eventSlug, ruleId));
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {pending ? "Activating…" : "Activate"}
    </Button>
  );
}

export function ReminderRuleCancelButton({
  eventSlug,
  ruleId,
}: {
  readonly eventSlug: string;
  readonly ruleId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          actionResultToast(await cancelSpeakerTaskReminderRule(eventSlug, ruleId));
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {pending ? "Cancelling…" : "Cancel"}
    </Button>
  );
}

export function AssignmentDueDateForm({
  assignmentId,
  defaultValue,
  eventSlug,
  speakerName,
}: {
  readonly assignmentId: string;
  readonly defaultValue: string;
  readonly eventSlug: string;
  readonly speakerName: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateSpeakerTaskDueDate.bind(null, eventSlug, assignmentId),
    INITIAL_STATE,
  );
  useActionToast(state);

  return (
    <form noValidate action={formAction} className="flex items-center gap-2">
      <Field>
        <FieldLabel htmlFor={`due-${assignmentId}`} className="sr-only">
          Due date for {speakerName}
        </FieldLabel>
        <DatePicker id={`due-${assignmentId}`} name="dueAt" defaultValue={defaultValue} />
      </Field>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        aria-label={`Save due date for ${speakerName}`}
      >
        {pending ? <Spinner data-icon="inline-start" /> : <CalendarClock data-icon="inline-start" />}
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function ApproveTaskButton({
  assignmentId,
  eventSlug,
}: {
  readonly assignmentId: string;
  readonly eventSlug: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          actionResultToast(await approveSpeakerTask(eventSlug, assignmentId));
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
      {pending ? "Approving…" : "Approve"}
    </Button>
  );
}

export function RevisionRequestForm({
  assignmentId,
  eventSlug,
  speakerName,
}: {
  readonly assignmentId: string;
  readonly eventSlug: string;
  readonly speakerName: string;
}) {
  const [state, formAction, pending] = useActionState(
    requestSpeakerTaskRevision.bind(null, eventSlug, assignmentId),
    INITIAL_STATE,
  );
  useActionToast(state);

  return (
    <form noValidate action={formAction} className="flex min-w-64 flex-col gap-2">
      <Field>
        <FieldLabel htmlFor={`feedback-${assignmentId}`} className="sr-only">
          Revision feedback for {speakerName}
        </FieldLabel>
        <Textarea
          id={`feedback-${assignmentId}`}
          name="feedback"
          placeholder="Explain what needs to change"
          rows={2}
          required
        />
      </Field>
      <Button type="submit" size="sm" variant="outline" className="self-end" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
        {pending ? "Requesting…" : "Request revision"}
      </Button>
    </form>
  );
}

export function ReminderOptOutButton({
  assignmentId,
  eventSlug,
  optedOut,
}: {
  readonly assignmentId: string;
  readonly eventSlug: string;
  readonly optedOut: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const pendingLabel = optedOut ? "Resuming…" : "Pausing…";
  const idleLabel = optedOut ? "Resume reminders" : "Pause reminders";
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          actionResultToast(await setSpeakerTaskReminderOptOut(eventSlug, assignmentId, !optedOut));
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}

export function WithdrawTaskButton({
  assignmentId,
  eventSlug,
  speakerName,
}: {
  readonly assignmentId: string;
  readonly eventSlug: string;
  readonly speakerName: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      disabled={pending}
      aria-label={`Withdraw task for ${speakerName}`}
      onClick={() =>
        startTransition(async () => {
          actionResultToast(await withdrawSpeakerTask(eventSlug, assignmentId));
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : <UserX data-icon="inline-start" />}
      {pending ? "Withdrawing…" : "Withdraw"}
    </Button>
  );
}
