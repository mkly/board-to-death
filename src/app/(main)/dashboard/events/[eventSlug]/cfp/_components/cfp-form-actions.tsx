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
  { readonly title: string; readonly description: string; readonly label: string }
> = {
  duplicate: {
    title: "Duplicate this CFP form?",
    description: "This creates a separate draft with a new public identity. Existing responses are not copied.",
    label: "Duplicate form",
  },
  close: {
    title: "Close this CFP form?",
    description: "New responses will be stopped. You can reopen the form later.",
    label: "Close form",
  },
  reopen: {
    title: "Reopen this CFP form?",
    description: "The published form will accept responses again under its existing public identity.",
    label: "Reopen form",
  },
  archive: {
    title: "Archive this CFP form?",
    description: "Archived forms cannot be reopened. Existing responses and the audit history are retained.",
    label: "Archive form",
  },
};

function SubmitAction({ label }: { readonly label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="destructive" disabled={pending}>
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
  const [selectedAction, setSelectedAction] = useState<FormAction | null>(null);
  const mutation = formActions[selectedAction ?? "duplicate"].bind(null, eventSlug, form.id);
  const content = selectedAction ? actionContent[selectedAction] : actionContent.duplicate;

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
            <DropdownMenuItem onSelect={() => setSelectedAction("duplicate")}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            {form.status === "PUBLISHED" ? (
              <DropdownMenuItem onSelect={() => setSelectedAction("close")}>
                <LockKeyhole />
                Close
              </DropdownMenuItem>
            ) : null}
            {form.status === "CLOSED" ? (
              <>
                <DropdownMenuItem onSelect={() => setSelectedAction("reopen")}>
                  <LockKeyholeOpen />
                  Reopen
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setSelectedAction("archive")}>
                  <Archive />
                  Archive
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={selectedAction !== null} onOpenChange={(open) => !open && setSelectedAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{content.title}</AlertDialogTitle>
            <AlertDialogDescription>{content.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={mutation}>
              <SubmitAction label={content.label} />
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
