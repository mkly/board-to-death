"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { ArrowDown, ArrowUp, CalendarCog, DoorOpen, MapPinned, Plus, Save, SwatchBook, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import { fireConfetti } from "@/components/confetti";
import { DateTimePicker } from "@/components/date-time-picker";
import { browserTimezone, TimezoneSelect } from "@/components/timezone-select";
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  archiveEvent,
  cloneEvent,
  createEvent,
  createRoom,
  createTrack,
  deleteRoom,
  deleteTrack,
  moveRoom,
  moveTrack,
  restoreEvent,
  updateEvent,
  updateRoom,
  updateTrack,
} from "../actions";
import type { EventOption, EventSettingsEvent, EventSettingsSnapshot, MutationResult } from "../types";
import { CreateEventWizard } from "./create-event-wizard";
import { EventLifecycleActions } from "./event-lifecycle-actions";

const EVENT_TYPES = ["CONFERENCE", "MEETUP", "WORKSHOP", "OTHER"] as const;
const TRACK_COLORS = ["slate", "rose", "orange", "amber", "emerald", "sky", "indigo", "violet"] as const;
const TRACK_COLOR_CLASSES: Record<(typeof TRACK_COLORS)[number], string> = {
  slate: "bg-slate-500",
  rose: "bg-rose-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
};

interface EventSettingsWorkspaceProps {
  readonly eventOptions: readonly EventOption[];
  readonly eventScoped?: boolean;
  readonly initialSnapshot: EventSettingsSnapshot | null;
}

type FieldErrors = MutationResult["fieldErrors"];

function localDateTime(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}

function firstError(errors: FieldErrors, field: string): string | undefined {
  return errors?.[field]?.[0];
}

function EventForm({
  event,
  errors,
  pending,
  onSubmit,
  submitLabel,
}: {
  readonly event?: EventSettingsEvent;
  readonly errors?: FieldErrors;
  readonly pending: boolean;
  readonly onSubmit: (formData: FormData) => Promise<void>;
  readonly submitLabel: string;
}) {
  const timezone = event?.timezone ?? browserTimezone();
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        void onSubmit(new FormData(formEvent.currentTarget));
      }}
    >
      <FieldGroup>
        <div className="grid gap-5 md:grid-cols-2">
          <Field data-invalid={Boolean(firstError(errors, "name"))}>
            <FieldLabel htmlFor="event-name">Event name</FieldLabel>
            <Input
              id="event-name"
              name="name"
              defaultValue={event?.name}
              aria-invalid={Boolean(firstError(errors, "name"))}
              required
            />
            <FieldError>{firstError(errors, "name")}</FieldError>
          </Field>
          <Field data-invalid={Boolean(firstError(errors, "slug"))}>
            <FieldLabel htmlFor="event-slug">Slug</FieldLabel>
            <Input
              id="event-slug"
              name="slug"
              defaultValue={event?.slug}
              aria-invalid={Boolean(firstError(errors, "slug"))}
              required
            />
            <FieldDescription>Lowercase letters, numbers, and single hyphens.</FieldDescription>
            <FieldError>{firstError(errors, "slug")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="event-type">Type</FieldLabel>
            <Select name="type" defaultValue={event?.type ?? "CONFERENCE"}>
              <SelectTrigger id="event-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {EVENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0) + type.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field data-invalid={Boolean(firstError(errors, "websiteUrl"))}>
            <FieldLabel htmlFor="event-website">Website URL</FieldLabel>
            <Input
              id="event-website"
              name="websiteUrl"
              type="url"
              defaultValue={event?.websiteUrl ?? ""}
              aria-invalid={Boolean(firstError(errors, "websiteUrl"))}
              placeholder="https://example.com"
            />
            <FieldError>{firstError(errors, "websiteUrl")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="event-location">Location</FieldLabel>
            <Input
              id="event-location"
              name="location"
              defaultValue={event?.location ?? ""}
              placeholder="Portland, Oregon"
            />
          </Field>
          <Field data-invalid={Boolean(firstError(errors, "timezone"))}>
            <FieldLabel htmlFor="event-timezone">Time zone</FieldLabel>
            <TimezoneSelect
              id="event-timezone"
              name="timezone"
              defaultValue={timezone}
              aria-invalid={Boolean(firstError(errors, "timezone"))}
            />
            <FieldDescription>Dates are entered in this time zone.</FieldDescription>
            <FieldError>{firstError(errors, "timezone")}</FieldError>
          </Field>
          <Field data-invalid={Boolean(firstError(errors, "startsAt"))}>
            <FieldLabel htmlFor="event-start">Starts</FieldLabel>
            <DateTimePicker
              id="event-start"
              name="startsAt"
              defaultValue={event ? localDateTime(event.startsAt, event.timezone) : ""}
              aria-invalid={Boolean(firstError(errors, "startsAt"))}
            />
            <FieldError>{firstError(errors, "startsAt")}</FieldError>
          </Field>
          <Field data-invalid={Boolean(firstError(errors, "endsAt"))}>
            <FieldLabel htmlFor="event-end">Ends</FieldLabel>
            <DateTimePicker
              id="event-end"
              name="endsAt"
              defaultValue={event ? localDateTime(event.endsAt, event.timezone) : ""}
              aria-invalid={Boolean(firstError(errors, "endsAt"))}
            />
            <FieldError>{firstError(errors, "endsAt")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="event-theme">Descriptive theme</FieldLabel>
            <Input
              id="event-theme"
              name="theme"
              defaultValue={event?.theme ?? ""}
              placeholder="Playful strategy and design"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-logo">Logo asset key</FieldLabel>
            <Input
              id="event-logo"
              name="logoObjectKey"
              defaultValue={event?.logoObjectKey ?? ""}
              placeholder="events/logo.svg"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-background">Background image asset key</FieldLabel>
            <Input
              id="event-background"
              name="backgroundObjectKey"
              defaultValue={event?.backgroundObjectKey ?? ""}
              placeholder="events/background.webp"
            />
          </Field>
        </div>
        <FieldSet>
          <FieldLegend variant="label">Program features</FieldLegend>
          <FieldGroup className="gap-3">
            <Field orientation="horizontal">
              <FieldLabel htmlFor="event-exhibitors" className="font-normal">
                <span className="flex flex-col gap-0.5">
                  <span>Exhibitors</span>
                  <span className="text-muted-foreground text-xs">Enable exhibitor administration for this event.</span>
                </span>
              </FieldLabel>
              <Switch id="event-exhibitors" name="exhibitorsEnabled" defaultChecked={event?.exhibitorsEnabled} />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="event-sponsors" className="font-normal">
                <span className="flex flex-col gap-0.5">
                  <span>Sponsors</span>
                  <span className="text-muted-foreground text-xs">Enable sponsor administration for this event.</span>
                </span>
              </FieldLabel>
              <Switch id="event-sponsors" name="sponsorsEnabled" defaultChecked={event?.sponsorsEnabled} />
            </Field>
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function DeleteButton({
  label,
  pending,
  onDelete,
}: {
  readonly label: string;
  readonly pending: boolean;
  readonly onDelete: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${label}`} disabled={pending}>
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {label}?</AlertDialogTitle>
          <AlertDialogDescription>This removes it from the event. This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function OrderButtons({
  index,
  count,
  pending,
  onMove,
}: {
  readonly index: number;
  readonly count: number;
  readonly pending: boolean;
  readonly onMove: (offset: -1 | 1) => void;
}) {
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Move up"
        disabled={pending || index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Move down"
        disabled={pending || index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown />
      </Button>
    </div>
  );
}

export function EventSettingsWorkspace({
  eventOptions: initialEventOptions,
  eventScoped = false,
  initialSnapshot,
}: EventSettingsWorkspaceProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [eventOptions, setEventOptions] = useState(initialEventOptions);
  const [pending, setPending] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [createOpen, setCreateOpen] = useState(initialSnapshot === null);

  const settingsHref = (eventId: string): string =>
    eventScoped
      ? `/dashboard/switch-event?eventId=${encodeURIComponent(eventId)}&workspace=settings`
      : `/dashboard/event-settings?event=${encodeURIComponent(eventId)}`;

  async function mutate(key: string, task: () => Promise<MutationResult>): Promise<MutationResult> {
    setPending(key);
    const result = await task();
    setPending(null);
    setFieldErrors(result.fieldErrors);
    if (result.ok) {
      if (result.snapshot) {
        const updatedSnapshot = result.snapshot;
        setSnapshot(updatedSnapshot);
        setEventOptions((current) => {
          const next = current.filter(({ id }) => id !== updatedSnapshot.event.id);
          return [
            ...next,
            {
              id: updatedSnapshot.event.id,
              name: updatedSnapshot.event.name,
              archived: updatedSnapshot.event.archivedAt !== null,
            },
          ];
        });
      }
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
    return result;
  }

  async function handleCreate(formData: FormData): Promise<void> {
    const result = await mutate("create-event", () => createEvent(formData));
    if (result.ok && result.snapshot) {
      setCreateOpen(false);
      if (result.firstEvent) fireConfetti();
      router.push(settingsHref(result.snapshot.event.id));
    }
  }

  async function handleClone(formData: FormData): Promise<boolean> {
    const result = await mutate("clone-event", () => cloneEvent(eventId, formData));
    if (result.ok && result.snapshot) router.push(settingsHref(result.snapshot.event.id));
    return result.ok;
  }

  if (!snapshot) {
    return (
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus data-icon="inline-start" />
            Create event
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create event</DialogTitle>
            <DialogDescription>A few quick steps to set up your event.</DialogDescription>
          </DialogHeader>
          <CreateEventWizard errors={fieldErrors} pending={pending === "create-event"} action={handleCreate} />
        </DialogContent>
      </Dialog>
    );
  }

  const eventId = snapshot.event.id;
  const run = (key: string, task: () => Promise<MutationResult>) => {
    void mutate(key, task);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-medium text-2xl leading-tight tracking-tight sm:text-3xl">Event settings</h1>
          <p className="text-muted-foreground text-sm">Manage event identity, schedule, rooms, and program tracks.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={eventId} onValueChange={(value) => router.push(settingsHref(value))}>
            <SelectTrigger aria-label="Select event">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {eventOptions.map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {event.name}
                    {event.archived ? " (archived)" : ""}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus data-icon="inline-start" />
                New event
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Create event</DialogTitle>
                <DialogDescription>A few quick steps to set up your event.</DialogDescription>
              </DialogHeader>
              <CreateEventWizard errors={fieldErrors} pending={pending === "create-event"} action={handleCreate} />
            </DialogContent>
          </Dialog>
          <EventLifecycleActions
            event={snapshot.event}
            pending={pending !== null}
            onClone={handleClone}
            onArchive={() => run("archive-event", () => archiveEvent(eventId))}
            onRestore={() => run("restore-event", () => restoreEvent(eventId))}
          />
        </div>
      </div>

      {snapshot.event.archivedAt ? (
        <Card>
          <CardHeader>
            <CardTitle>Archived event</CardTitle>
            <CardDescription>
              This event is preserved as read-only and is hidden from active navigation. Restore it to edit its settings
              or program data.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Tabs defaultValue="general">
          <TabsList variant="line">
            <TabsTrigger value="general">
              <CalendarCog data-icon="inline-start" />
              General
            </TabsTrigger>
            <TabsTrigger value="locations">
              <MapPinned data-icon="inline-start" />
              Rooms & tracks
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>Event details</CardTitle>
                <CardDescription>
                  Dates are entered in the event time zone and saved as precise instants.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EventForm
                  event={snapshot.event}
                  errors={fieldErrors}
                  pending={pending === "event"}
                  onSubmit={async (data) => {
                    await mutate("event", () => updateEvent(eventId, data));
                  }}
                  submitLabel="Save changes"
                />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="locations" className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DoorOpen />
                  Rooms
                </CardTitle>
                <CardDescription>
                  Names are unique within this event. Use the arrows to control agenda order.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {snapshot.rooms.map((room, index) => (
                  <form
                    key={room.id}
                    className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
                    onSubmit={(formEvent) => {
                      formEvent.preventDefault();
                      const data = new FormData(formEvent.currentTarget);
                      run(`room-${room.id}`, () => updateRoom(eventId, room.id, data));
                    }}
                  >
                    <Input name="name" defaultValue={room.name} aria-label="Room name" required className="flex-1" />
                    <div className="flex items-center justify-end gap-1">
                      <OrderButtons
                        index={index}
                        count={snapshot.rooms.length}
                        pending={pending !== null}
                        onMove={(offset) => run(`room-${room.id}`, () => moveRoom(eventId, room.id, offset))}
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Save ${room.name}`}
                        disabled={pending !== null}
                      >
                        {pending === `room-${room.id}` ? <Spinner /> : <Save />}
                      </Button>
                      <DeleteButton
                        label={room.name}
                        pending={pending !== null}
                        onDelete={() => run(`room-${room.id}`, () => deleteRoom(eventId, room.id))}
                      />
                    </div>
                  </form>
                ))}
              </CardContent>
              <CardFooter>
                <form
                  className="flex w-full gap-2"
                  onSubmit={(formEvent) => {
                    formEvent.preventDefault();
                    const form = formEvent.currentTarget;
                    const data = new FormData(form);
                    void mutate("new-room", () => createRoom(eventId, data)).then((result) => {
                      if (result.ok) form.reset();
                    });
                  }}
                >
                  <Input name="name" aria-label="New room name" placeholder="Add a room" required />
                  <Button type="submit" variant="outline" disabled={pending !== null}>
                    <Plus data-icon="inline-start" />
                    Add
                  </Button>
                </form>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SwatchBook />
                  Tracks
                </CardTitle>
                <CardDescription>Track colors use the shared Tailwind palette and remain event scoped.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {snapshot.tracks.map((track, index) => (
                  <form
                    key={track.id}
                    className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
                    onSubmit={(formEvent) => {
                      formEvent.preventDefault();
                      const data = new FormData(formEvent.currentTarget);
                      run(`track-${track.id}`, () => updateTrack(eventId, track.id, data));
                    }}
                  >
                    <span
                      className={cn(
                        "size-3 shrink-0 rounded-full",
                        TRACK_COLOR_CLASSES[track.color as keyof typeof TRACK_COLOR_CLASSES] ??
                          TRACK_COLOR_CLASSES.slate,
                      )}
                      aria-hidden="true"
                    />
                    <Input name="name" defaultValue={track.name} aria-label="Track name" required className="flex-1" />
                    <Select name="color" defaultValue={track.color}>
                      <SelectTrigger aria-label={`${track.name} color`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {TRACK_COLORS.map((color) => (
                            <SelectItem key={color} value={color}>
                              {color.charAt(0).toUpperCase() + color.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-end gap-1">
                      <OrderButtons
                        index={index}
                        count={snapshot.tracks.length}
                        pending={pending !== null}
                        onMove={(offset) => run(`track-${track.id}`, () => moveTrack(eventId, track.id, offset))}
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Save ${track.name}`}
                        disabled={pending !== null}
                      >
                        {pending === `track-${track.id}` ? <Spinner /> : <Save />}
                      </Button>
                      <DeleteButton
                        label={track.name}
                        pending={pending !== null}
                        onDelete={() => run(`track-${track.id}`, () => deleteTrack(eventId, track.id))}
                      />
                    </div>
                  </form>
                ))}
              </CardContent>
              <CardFooter>
                <form
                  className="flex w-full flex-col gap-2 sm:flex-row"
                  onSubmit={(formEvent) => {
                    formEvent.preventDefault();
                    const form = formEvent.currentTarget;
                    const data = new FormData(form);
                    void mutate("new-track", () => createTrack(eventId, data)).then((result) => {
                      if (result.ok) form.reset();
                    });
                  }}
                >
                  <Input
                    name="name"
                    aria-label="New track name"
                    placeholder="Add a track"
                    required
                    className="flex-1"
                  />
                  <Select name="color" defaultValue="slate">
                    <SelectTrigger aria-label="New track color">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {TRACK_COLORS.map((color) => (
                          <SelectItem key={color} value={color}>
                            {color.charAt(0).toUpperCase() + color.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button type="submit" variant="outline" disabled={pending !== null}>
                    <Plus data-icon="inline-start" />
                    Add
                  </Button>
                </form>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
