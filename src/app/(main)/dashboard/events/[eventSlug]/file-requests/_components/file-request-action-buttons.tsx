"use client";

import { useActionState, useTransition } from "react";

import { Archive, ArchiveRestore, Send } from "lucide-react";

import { FormSelect } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { FileRequestTargetKind } from "@/generated/prisma/client";
import { actionResultToast, useActionToast } from "@/hooks/use-action-toast";

import {
  archiveFileRequestAction,
  assignFileRequestAction,
  type FileRequestActionState,
  resendFulfillmentLinkAction,
  restoreFileRequestAction,
  withdrawAssignmentAction,
} from "../actions";

const INITIAL_STATE: FileRequestActionState = { status: "idle" };

export function RestoreRequestButton({
  eventSlug,
  requestId,
}: {
  readonly eventSlug: string;
  readonly requestId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          actionResultToast(await restoreFileRequestAction(eventSlug, requestId));
        });
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {pending ? <Spinner data-icon="inline-start" /> : <ArchiveRestore data-icon="inline-start" />}
      Restore
    </Button>
  );
}

export function ArchiveToggleButton({
  eventSlug,
  requestId,
  archived,
}: {
  readonly eventSlug: string;
  readonly requestId: string;
  readonly archived: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const Icon = archived ? ArchiveRestore : Archive;
  return (
    <Button
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const action = archived ? restoreFileRequestAction : archiveFileRequestAction;
          actionResultToast(await action(eventSlug, requestId));
        });
      }}
      type="button"
      variant="outline"
    >
      {pending ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
      {archived ? "Restore" : "Archive"}
    </Button>
  );
}

export function ResendLinkButton({
  eventSlug,
  requestId,
  assignmentId,
}: {
  readonly eventSlug: string;
  readonly requestId: string;
  readonly assignmentId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          actionResultToast(await resendFulfillmentLinkAction(eventSlug, requestId, assignmentId));
        });
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {pending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
      Resend link
    </Button>
  );
}

export function WithdrawAssignmentButton({
  eventSlug,
  requestId,
  assignmentId,
}: {
  readonly eventSlug: string;
  readonly requestId: string;
  readonly assignmentId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          actionResultToast(await withdrawAssignmentAction(eventSlug, requestId, assignmentId));
        });
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Withdraw
    </Button>
  );
}

export function AssignRequestForm({
  eventSlug,
  requestId,
  targetKind,
  archived,
  targets,
}: {
  readonly eventSlug: string;
  readonly requestId: string;
  readonly targetKind: FileRequestTargetKind;
  readonly archived: boolean;
  readonly targets: readonly { readonly id: string; readonly label: string; readonly description: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    assignFileRequestAction.bind(null, eventSlug, requestId),
    INITIAL_STATE,
  );
  useActionToast(state);
  return (
    <form noValidate action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input name="targetKind" type="hidden" value={targetKind} />
      <Field className="sm:max-w-sm">
        <FieldLabel htmlFor="assign-target">Target</FieldLabel>
        <FormSelect
          className="w-full"
          disabled={archived}
          id="assign-target"
          name="targetId"
          required
          placeholder="Choose a target…"
          options={targets.map((target) => ({
            value: target.id,
            label: `${target.label} — ${target.description}`,
          }))}
        />
        <FieldDescription>The assignment captures today's upload rules.</FieldDescription>
      </Field>
      <Button disabled={archived || pending} type="submit">
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Assign
      </Button>
    </form>
  );
}
