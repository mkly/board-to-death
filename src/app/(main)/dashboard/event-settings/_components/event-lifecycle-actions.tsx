"use client";

import { useState } from "react";

import { Archive, ArchiveRestore, Copy } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

interface EventLifecycleActionsProps {
  readonly event: { readonly name: string; readonly slug: string; readonly archivedAt: string | null };
  readonly pending: boolean;
  readonly onClone: (formData: FormData) => Promise<boolean>;
  readonly onArchive: () => void;
  readonly onRestore: () => void;
}

const CLONE_OPTIONS = [
  ["rooms", "Rooms", "Copy ordered room configuration."],
  ["tracks", "Tracks", "Copy ordered program tracks."],
  ["forms", "Forms", "Copy CFP form versions, steps, and questions."],
  ["tasks", "Onboarding tasks", "Copy task definitions and versions, not assignments."],
  ["templates", "Communication templates", "Copy template versions, not delivery history."],
  ["portalSettings", "Portal settings", "Copy branding and speaker resource pages."],
] as const;

function copySlug(slug: string): string {
  return `${slug}-copy`;
}

export function EventLifecycleActions({ event, pending, onClone, onArchive, onRestore }: EventLifecycleActionsProps) {
  const [cloneOpen, setCloneOpen] = useState(false);
  const archived = event.archivedAt !== null;

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" disabled={pending}>
            <Copy data-icon="inline-start" />
            Clone event
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Clone {event.name}</DialogTitle>
            <DialogDescription>
              The clone starts with no contacts, submissions, sessions, assignments, delivery history, or schedule.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5"
            onSubmit={(formEvent) => {
              formEvent.preventDefault();
              void onClone(new FormData(formEvent.currentTarget)).then((cloned) => {
                if (cloned) setCloneOpen(false);
              });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="clone-event-name">Event name</FieldLabel>
                <Input id="clone-event-name" name="name" defaultValue={`${event.name} copy`} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="clone-event-slug">Slug</FieldLabel>
                <Input id="clone-event-slug" name="slug" defaultValue={copySlug(event.slug)} required />
                <FieldDescription>Use a unique lowercase slug.</FieldDescription>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Configuration to carry over</FieldLegend>
                <FieldGroup className="gap-3">
                  {CLONE_OPTIONS.map(([name, label, description]) => {
                    const id = `clone-event-${name}`;
                    return (
                      <Field key={name} orientation="horizontal">
                        <Checkbox id={id} name={name} defaultChecked />
                        <div className="flex flex-1 flex-col gap-0.5">
                          <FieldLabel htmlFor={id} className="font-normal">
                            {label}
                          </FieldLabel>
                          <FieldDescription>{description}</FieldDescription>
                        </div>
                      </Field>
                    );
                  })}
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                Create clone
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant={archived ? "outline" : "destructive"} disabled={pending}>
            {archived ? <ArchiveRestore data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
            {archived ? "Restore event" : "Archive event"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{archived ? `Restore ${event.name}?` : `Archive ${event.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? "The event returns to active navigation and can be edited again."
                : "The event leaves active navigation and becomes read-only. Its data is preserved."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={archived ? "default" : "destructive"}
              onClick={archived ? onRestore : onArchive}
            >
              {archived ? "Restore event" : "Archive event"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
