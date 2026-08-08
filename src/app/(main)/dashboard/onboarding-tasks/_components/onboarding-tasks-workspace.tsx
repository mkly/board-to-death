"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  Copy,
  FileUp,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
} from "lucide-react";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { archiveDefinition, createDefinition, duplicateDefinition, moveDefinition, updateDefinition } from "../actions";
import type { EventOption, MutationResult, OnboardingSnapshot, TaskDefinitionView, TaskResponseType } from "../types";

interface OnboardingTasksWorkspaceProps {
  readonly eventOptions: readonly EventOption[];
  readonly initialSnapshot: OnboardingSnapshot;
}

type FieldErrors = MutationResult["fieldErrors"];

const RESPONSE_LABELS: Record<TaskResponseType, string> = {
  NONE: "No response",
  TEXT: "Written response",
  FILE: "File upload",
};

function firstError(errors: FieldErrors, field: string): string | undefined {
  return errors?.[field]?.[0];
}

function DefinitionForm({
  definition,
  errors,
  pending,
  onSubmit,
}: {
  readonly definition?: TaskDefinitionView;
  readonly errors?: FieldErrors;
  readonly pending: boolean;
  readonly onSubmit: (formData: FormData) => Promise<void>;
}) {
  let submitLabel = "Create task";
  if (pending) submitLabel = "Saving…";
  else if (definition) submitLabel = "Save changes";

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(new FormData(event.currentTarget));
      }}
    >
      <FieldGroup>
        <Field data-invalid={Boolean(firstError(errors, "title"))}>
          <FieldLabel htmlFor="task-title">Task title</FieldLabel>
          <Input
            id="task-title"
            name="title"
            defaultValue={definition?.title}
            aria-invalid={Boolean(firstError(errors, "title"))}
            placeholder="Upload a speaker headshot"
            required
          />
          <FieldError>{firstError(errors, "title")}</FieldError>
        </Field>
        <Field data-invalid={Boolean(firstError(errors, "description"))}>
          <FieldLabel htmlFor="task-description">Instructions</FieldLabel>
          <Textarea
            id="task-description"
            name="description"
            defaultValue={definition?.description ?? ""}
            aria-invalid={Boolean(firstError(errors, "description"))}
            placeholder="Explain what the speaker needs to provide."
            rows={4}
          />
          <FieldError>{firstError(errors, "description")}</FieldError>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(firstError(errors, "defaultDueOffsetDays"))}>
            <FieldLabel htmlFor="task-due-offset">Due after assignment</FieldLabel>
            <Input
              id="task-due-offset"
              name="defaultDueOffsetDays"
              type="number"
              min="0"
              max="365"
              defaultValue={definition?.defaultDueOffsetDays ?? ""}
              aria-invalid={Boolean(firstError(errors, "defaultDueOffsetDays"))}
              placeholder="No default"
            />
            <FieldDescription>Number of days; leave blank for no default due date.</FieldDescription>
            <FieldError>{firstError(errors, "defaultDueOffsetDays")}</FieldError>
          </Field>
          <Field data-invalid={Boolean(firstError(errors, "responseType"))}>
            <FieldLabel htmlFor="task-response-type">Required response</FieldLabel>
            <Select name="responseType" defaultValue={definition?.responseType ?? "NONE"}>
              <SelectTrigger
                id="task-response-type"
                className="w-full"
                aria-invalid={Boolean(firstError(errors, "responseType"))}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(RESPONSE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError>{firstError(errors, "responseType")}</FieldError>
          </Field>
        </div>
        <Field data-invalid={Boolean(firstError(errors, "sessionKinds"))}>
          <FieldLabel htmlFor="task-session-kinds">Session kinds</FieldLabel>
          <Input
            id="task-session-kinds"
            name="sessionKinds"
            defaultValue={definition?.sessionKinds.join(", ")}
            aria-invalid={Boolean(firstError(errors, "sessionKinds"))}
            placeholder="TALK, WORKSHOP"
          />
          <FieldDescription>Optional comma-separated applicability rule.</FieldDescription>
          <FieldError>{firstError(errors, "sessionKinds")}</FieldError>
        </Field>
        <Field orientation="horizontal">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="task-confirmed-only">Confirmed speakers only</FieldLabel>
            <FieldDescription>Assign this task only after a speaker confirms participation.</FieldDescription>
          </div>
          <Switch id="task-confirmed-only" name="confirmedOnly" defaultChecked={definition?.confirmedOnly} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ResponseBadge({ type }: { readonly type: TaskResponseType }) {
  const icons = { FILE: FileUp, NONE: ClipboardCheck, TEXT: MessageSquareText } as const;
  const Icon = icons[type];
  return (
    <Badge variant="secondary">
      <Icon />
      {RESPONSE_LABELS[type]}
    </Badge>
  );
}

export function OnboardingTasksWorkspace({ eventOptions, initialSnapshot }: OnboardingTasksWorkspaceProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [pending, setPending] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TaskDefinitionView | null>(null);

  const activeDefinitions = snapshot.definitions.filter(({ archivedAt }) => archivedAt === null);
  const archivedDefinitions = snapshot.definitions.filter(({ archivedAt }) => archivedAt !== null);

  async function mutate(key: string, task: () => Promise<MutationResult>): Promise<MutationResult> {
    setPending(key);
    const result = await task();
    setPending(null);
    setFieldErrors(result.fieldErrors);
    if (result.ok) {
      if (result.snapshot) setSnapshot(result.snapshot);
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
    return result;
  }

  async function handleCreate(formData: FormData): Promise<void> {
    const result = await mutate("create", () => createDefinition(snapshot.eventId, formData));
    if (result.ok) setCreateOpen(false);
  }

  async function handleUpdate(formData: FormData): Promise<void> {
    if (!editing) return;
    const result = await mutate(`edit-${editing.id}`, () => updateDefinition(snapshot.eventId, editing.id, formData));
    if (result.ok) setEditing(null);
  }

  function run(key: string, task: () => Promise<MutationResult>): void {
    void mutate(key, task);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Speaker onboarding</h1>
          <p className="text-muted-foreground text-sm">
            Build reusable tasks, response requirements, due rules, and speaker applicability for each event.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            value={snapshot.eventId}
            onValueChange={(eventId) => router.push(`/dashboard/onboarding-tasks?event=${eventId}`)}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Select event">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {eventOptions.map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {event.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Dialog
            open={createOpen}
            onOpenChange={(open) => {
              setCreateOpen(open);
              setFieldErrors(undefined);
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus data-icon="inline-start" />
                New task
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create onboarding task</DialogTitle>
                <DialogDescription>Define what speakers need to do and when it applies.</DialogDescription>
              </DialogHeader>
              <DefinitionForm errors={fieldErrors} pending={pending === "create"} onSubmit={handleCreate} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {activeDefinitions.length === 0 ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheck />
            </EmptyMedia>
            <EmptyTitle>No onboarding tasks</EmptyTitle>
            <EmptyDescription>Create a reusable task for speaker profiles, files, or confirmations.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus data-icon="inline-start" />
              Create first task
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {activeDefinitions.map((definition, index) => (
            <Card key={definition.id}>
              <CardHeader>
                <CardTitle>{definition.title}</CardTitle>
                <CardDescription>{definition.description || "No instructions provided."}</CardDescription>
                <CardAction>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${definition.title} up`}
                      disabled={pending !== null || index === 0}
                      onClick={() =>
                        run(`move-${definition.id}`, () => moveDefinition(snapshot.eventId, definition.id, -1))
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${definition.title} down`}
                      disabled={pending !== null || index === activeDefinitions.length - 1}
                      onClick={() =>
                        run(`move-${definition.id}`, () => moveDefinition(snapshot.eventId, definition.id, 1))
                      }
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <ResponseBadge type={definition.responseType} />
                <Badge variant="outline">
                  {definition.defaultDueOffsetDays === null
                    ? "No default due date"
                    : `Due in ${definition.defaultDueOffsetDays} days`}
                </Badge>
                {definition.confirmedOnly ? <Badge variant="outline">Confirmed speakers</Badge> : null}
                {definition.sessionKinds.map((kind) => (
                  <Badge key={kind} variant="outline">
                    {kind}
                  </Badge>
                ))}
              </CardContent>
              <CardFooter className="justify-between gap-2">
                <span className="text-muted-foreground text-xs">Version {definition.versionNumber}</span>
                <div className="flex flex-wrap justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending !== null}
                    onClick={() =>
                      run(`copy-${definition.id}`, () => duplicateDefinition(snapshot.eventId, definition.id))
                    }
                  >
                    <Copy data-icon="inline-start" />
                    Duplicate
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending !== null}
                    onClick={() => {
                      setFieldErrors(undefined);
                      setEditing(definition);
                    }}
                  >
                    <Pencil data-icon="inline-start" />
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" disabled={pending !== null}>
                        <Archive data-icon="inline-start" />
                        Archive
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive {definition.title}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Existing assignments keep their saved version. The task will no longer be available for new
                          assignments.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            run(`archive-${definition.id}`, () => archiveDefinition(snapshot.eventId, definition.id))
                          }
                        >
                          Archive
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {archivedDefinitions.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Archived tasks</CardTitle>
            <CardDescription>Retained for assignment and audit history.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {archivedDefinitions.map((definition) => (
              <Badge key={definition.id} variant="secondary">
                {definition.title}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
          setFieldErrors(undefined);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit onboarding task</DialogTitle>
            <DialogDescription>Saving creates a new version for future assignments.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <DefinitionForm
              key={`${editing.id}-${editing.versionNumber}`}
              definition={editing}
              errors={fieldErrors}
              pending={pending === `edit-${editing.id}`}
              onSubmit={handleUpdate}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
