"use client";

import { useId } from "react";

import { FileText, FileUp, Info, Pencil, Plus, Users } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { FileRequestReplacementPolicy, FileRequestTargetKind } from "@/generated/prisma/client";

import { createFileRequestAction, updateFileRequestAction } from "../actions";
import { CONTENT_TYPE_OPTIONS, TARGET_KIND_DESCRIPTIONS, TARGET_KIND_LABELS } from "./file-request-options";

export interface FileRequestFormValues {
  readonly id: string;
  readonly targetKind: FileRequestTargetKind;
  readonly title: string;
  readonly instructions: string | null;
  readonly dueOffsetDays: number | null;
  readonly allowedContentTypes: readonly string[];
  readonly maxBytes: number;
  readonly replacementPolicy: FileRequestReplacementPolicy;
}

const TARGET_KIND_ICONS = { CONTACT: Users, GROUP: FileText, SUBMISSION: FileUp } as const;
const TARGET_KINDS: readonly FileRequestTargetKind[] = ["CONTACT", "GROUP", "SUBMISSION"];

function SubmitButton({ label }: { readonly label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {pending ? "Saving…" : label}
    </Button>
  );
}

function TargetKindCards({ selected }: { readonly selected: FileRequestTargetKind }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {TARGET_KINDS.map((kind) => {
        const Icon = TARGET_KIND_ICONS[kind];
        return (
          <label
            className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-input p-3 text-center transition-colors has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            key={kind}
          >
            <input
              className="sr-only"
              defaultChecked={kind === selected}
              name="targetKind"
              required
              type="radio"
              value={kind}
            />
            <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
            <span className="font-medium text-sm">{TARGET_KIND_LABELS[kind]}</span>
            <span className="text-muted-foreground text-xs">{TARGET_KIND_DESCRIPTIONS[kind]}</span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * One sheet serves creating and editing. Editing appends a new request version rather than
 * rewriting the old one, so the target kind stays fixed once assignments exist against it.
 */
export function FileRequestFormSheet({
  eventSlug,
  request,
  label,
}: {
  readonly eventSlug: string;
  readonly request?: FileRequestFormValues;
  readonly label?: string;
}) {
  const fieldId = useId();
  const editing = request !== undefined;
  const action = editing
    ? updateFileRequestAction.bind(null, eventSlug, request.id)
    : createFileRequestAction.bind(null, eventSlug);
  const allowed = new Set(request?.allowedContentTypes ?? ["application/pdf"]);
  const triggerLabel = label ?? (editing ? "Edit" : "Add");

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant={editing ? "outline" : "default"}>
          {editing ? <Pencil data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit file request" : "Add file request"}</SheetTitle>
          <SheetDescription>
            {editing
              ? "Changes apply to assignments created from here on; existing assignments keep the rules they were shown."
              : "Create a new file request for participants"}
          </SheetDescription>
        </SheetHeader>

        <form action={action} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-4 px-4">
            <div className="flex gap-2.5 rounded-lg border bg-muted/50 p-3">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <p className="font-medium text-sm">Files are stored, not attached</p>
                <p className="text-muted-foreground text-xs">
                  Uploaded files live on this file request and can be downloaded or exported. They are not attached to
                  the contact, group, or session record.
                </p>
              </div>
            </div>

            <Field>
              <FieldLabel htmlFor={`${fieldId}-title`}>Title</FieldLabel>
              <Input
                defaultValue={request?.title}
                id={`${fieldId}-title`}
                name="title"
                placeholder="e.g. Upload Presentation Slides"
                required
              />
            </Field>

            <Field>
              {/* Neither branch is a single labelable control — the create form is a radio group and the edit
                  form is static text — so this is a title, not a `label` pointing at nothing. */}
              <FieldTitle>Type</FieldTitle>
              {editing ? (
                <FieldDescription>
                  {TARGET_KIND_LABELS[request.targetKind]} — the target type cannot change after a request is created.
                  <input name="targetKind" type="hidden" value={request.targetKind} />
                </FieldDescription>
              ) : (
                <TargetKindCards selected="CONTACT" />
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor={`${fieldId}-instructions`}>Instructions</FieldLabel>
              <Textarea
                className="min-h-28"
                defaultValue={request?.instructions ?? ""}
                id={`${fieldId}-instructions`}
                name="instructions"
                placeholder="Enter instructions…"
              />
              <FieldDescription>Markdown is supported.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor={`${fieldId}-due`}>Due before the event starts</FieldLabel>
              <Input
                defaultValue={request?.dueOffsetDays ?? ""}
                id={`${fieldId}-due`}
                min={0}
                name="dueOffsetDays"
                placeholder="e.g. 14"
                step={1}
                type="number"
              />
              <FieldDescription>Days before the event start date. Leave empty for no due date.</FieldDescription>
            </Field>

            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium text-sm">Accepted file types</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {CONTENT_TYPE_OPTIONS.map((option) => (
                  <Label className="font-normal text-sm" key={option.value}>
                    <input
                      className="size-4 accent-primary"
                      defaultChecked={allowed.has(option.value)}
                      name="allowedContentTypes"
                      type="checkbox"
                      value={option.value}
                    />
                    {option.label}
                  </Label>
                ))}
              </div>
            </fieldset>

            <Field>
              <FieldLabel htmlFor={`${fieldId}-size`}>Maximum size (MB)</FieldLabel>
              <Input
                defaultValue={request ? Math.round(request.maxBytes / (1024 * 1024)) : 10}
                id={`${fieldId}-size`}
                min={1}
                name="maxMegabytes"
                required
                step={1}
                type="number"
              />
            </Field>

            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium text-sm">When a file is re-uploaded</legend>
              <Label className="font-normal text-sm">
                <input
                  className="size-4 accent-primary"
                  defaultChecked={(request?.replacementPolicy ?? "REPLACE_LATEST") === "REPLACE_LATEST"}
                  name="replacementPolicy"
                  type="radio"
                  value="REPLACE_LATEST"
                />
                Replace the previous file
              </Label>
              <Label className="font-normal text-sm">
                <input
                  className="size-4 accent-primary"
                  defaultChecked={request?.replacementPolicy === "KEEP_HISTORY"}
                  name="replacementPolicy"
                  type="radio"
                  value="KEEP_HISTORY"
                />
                Keep every uploaded file
              </Label>
            </fieldset>
          </div>

          <SheetFooter className="flex-row justify-end gap-2">
            <SheetClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </SheetClose>
            <SubmitButton label={editing ? "Save file request" : "Create file request"} />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
