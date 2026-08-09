"use client";

import { useState } from "react";

import Link from "next/link";

import { Archive, Copy, Ellipsis, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import { useFormStatus } from "react-dom";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { CfpFormSummary } from "@/server/cfp/repositories";

import { archiveCfpForm, closeCfpForm, duplicateCfpForm, reopenCfpForm } from "../actions";

type FormAction = "archive" | "close" | "duplicate" | "reopen";

const formActions = {
  archive: archiveCfpForm,
  close: closeCfpForm,
  duplicate: duplicateCfpForm,
  reopen: reopenCfpForm,
} as const;

const actionContent: Record<
  FormAction,
  {
    readonly title: string;
    readonly description: string;
    readonly label: string;
    readonly variant: "default" | "destructive";
  }
> = {
  duplicate: {
    title: "Duplicate this CFP form?",
    description: "This creates a separate draft with a new public identity. Existing responses are not copied.",
    label: "Duplicate form",
    variant: "default",
  },
  close: {
    title: "Close this CFP form?",
    description: "New responses will be stopped. You can reopen the form later.",
    label: "Close form",
    variant: "destructive",
  },
  reopen: {
    title: "Reopen this CFP form?",
    description: "The published form will accept responses again under its existing public identity.",
    label: "Reopen form",
    variant: "default",
  },
  archive: {
    title: "Archive this CFP form?",
    description: "Archived forms cannot be reopened. Existing responses and the audit history are retained.",
    label: "Archive form",
    variant: "destructive",
  },
};

function SubmitAction({ label, variant }: { readonly label: string; readonly variant: "default" | "destructive" }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {pending ? "Updating…" : label}
    </Button>
  );
}

export function CfpFormActions({
  eventSlug,
  form,
  setupHref,
}: {
  readonly eventSlug: string;
  readonly form: CfpFormSummary;
  readonly setupHref: string;
}) {
  // The selected action outlives the dialog's close animation so the confirmation copy and the bound
  // server action never flip back to "duplicate" while the dialog is still on screen.
  const [selectedAction, setSelectedAction] = useState<FormAction>("duplicate");
  const [confirming, setConfirming] = useState(false);
  const mutation = formActions[selectedAction].bind(null, eventSlug, form.id);
  const content = actionContent[selectedAction];

  const confirm = (action: FormAction) => {
    setSelectedAction(action);
    setConfirming(true);
  };

  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" asChild>
        <Link href={setupHref}>Edit</Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={`Actions for ${form.title}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => confirm("duplicate")}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            {form.status === "PUBLISHED" ? (
              <DropdownMenuItem onSelect={() => confirm("close")}>
                <LockKeyhole />
                Close
              </DropdownMenuItem>
            ) : null}
            {form.status === "CLOSED" ? (
              <>
                <DropdownMenuItem onSelect={() => confirm("reopen")}>
                  <LockKeyholeOpen />
                  Reopen
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => confirm("archive")}>
                  <Archive />
                  Archive
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{content.title}</AlertDialogTitle>
            <AlertDialogDescription>{content.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={mutation}>
              <SubmitAction label={content.label} variant={content.variant} />
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
