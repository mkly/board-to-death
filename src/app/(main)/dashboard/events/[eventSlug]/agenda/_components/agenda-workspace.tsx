"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { CalendarPlus, Save, Trash2, TriangleAlert } from "lucide-react";

import { DateTimePicker } from "@/components/date-time-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import {
  type AgendaConflictState,
  type AgendaMutationState,
  removeAgendaPlacement,
  saveAgendaPlacement,
} from "../actions";
import { AgendaScheduleBoard } from "./agenda-schedule-board";
import { type AgendaFilter, AgendaViews } from "./agenda-views";
import { AssistedSchedulingCard } from "./assisted-scheduling-card";

export interface AgendaWorkspaceSession {
  readonly id: string;
  readonly title: string;
  readonly parentSessionId: string | null;
  readonly parentSessionTitle: string | null;
  readonly durationMinutes: number;
  readonly trackId: string | null;
  readonly trackName: string | null;
  readonly speakerIds: readonly string[];
  readonly speakerNames: readonly string[];
  readonly placement: {
    readonly id: string;
    readonly startsAt: string;
    readonly startsAtLocal: string;
    readonly endsAt: string;
    readonly durationMinutes: number;
    readonly roomId: string;
    readonly roomName: string;
    readonly trackId: string | null;
    readonly version: number;
  } | null;
}

interface AgendaWorkspaceProps {
  readonly event: {
    readonly name: string;
    readonly slug: string;
    readonly timezone: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly defaultStartsAtLocal: string;
  };
  readonly sessions: readonly AgendaWorkspaceSession[];
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
}

type ConflictPolicy = "prevent" | "explicit-confirm";

const INITIAL_MUTATION_STATE: AgendaMutationState = { status: "idle" };

function fieldError(state: AgendaMutationState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function formatInstant(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function saveButtonLabel(pending: boolean, scheduled: boolean): string {
  if (pending) return "Saving...";
  return scheduled ? "Save placement" : "Add to agenda";
}

function conflictLabel(
  conflict: AgendaConflictState,
  selected: AgendaWorkspaceSession,
  sessions: readonly AgendaWorkspaceSession[],
  rooms: AgendaWorkspaceProps["rooms"],
  tracks: AgendaWorkspaceProps["tracks"],
  timezone: string,
): string {
  const selectedPlacementId = selected.placement?.id;
  const otherPlacementId = conflict.placementIds.find(
    (placementId) => placementId !== selectedPlacementId && placementId !== `new:${selected.id}`,
  );
  const otherSession = sessions.find(({ placement }) => placement?.id === otherPlacementId);
  const window = `${formatInstant(conflict.startsAt, timezone)}–${new Intl.DateTimeFormat("en", {
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(conflict.endsAt))}`;
  if (conflict.type === "event-boundary") return `${selected.title} falls outside the event schedule (${window}).`;
  let resource: string | undefined;
  let typeLabel: string;
  if (conflict.type === "room") {
    resource = rooms.find(({ id }) => id === conflict.resourceId)?.name;
    typeLabel = "Room";
  } else if (conflict.type === "track") {
    resource = tracks.find(({ id }) => id === conflict.resourceId)?.name;
    typeLabel = "Track";
  } else {
    resource = selected.speakerNames.find((_, index) => selected.speakerIds[index] === conflict.resourceId);
    typeLabel = "Speaker";
  }
  return `${typeLabel} ${resource ?? "assignment"} overlaps with ${otherSession?.title ?? "another session"} (${window}).`;
}

function PlacementForm({
  event,
  session,
  sessions,
  rooms,
  tracks,
}: {
  readonly event: AgendaWorkspaceProps["event"];
  readonly session: AgendaWorkspaceSession;
  readonly sessions: AgendaWorkspaceProps["sessions"];
  readonly rooms: AgendaWorkspaceProps["rooms"];
  readonly tracks: AgendaWorkspaceProps["tracks"];
}) {
  const placement = session.placement;
  const [startsAt, setStartsAt] = useState(placement?.startsAtLocal ?? event.defaultStartsAtLocal);
  const [durationMinutes, setDurationMinutes] = useState(String(placement?.durationMinutes ?? session.durationMinutes));
  const [roomId, setRoomId] = useState(placement?.roomId ?? rooms[0]?.id ?? "");
  const [trackId, setTrackId] = useState(placement?.trackId ?? session.trackId ?? "unassigned");
  const [policy, setPolicy] = useState<ConflictPolicy>("prevent");
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [state, formAction, pending] = useActionState(saveAgendaPlacement, INITIAL_MUTATION_STATE);
  const formId = `agenda-placement-${session.id}`;

  useEffect(() => {
    setConflictDialogOpen(state.status === "conflict" && state.confirmationRequired === true);
    if (state.values) {
      setStartsAt(state.values.startsAt);
      setDurationMinutes(state.values.durationMinutes);
      setRoomId(state.values.roomId);
      setTrackId(state.values.trackId);
      setPolicy(state.values.conflictPolicy);
    }
  }, [state]);

  const conflicts = state.conflicts ?? [];

  return (
    <form id={formId} action={formAction}>
      <input type="hidden" name="eventSlug" value={event.slug} />
      <input type="hidden" name="sessionId" value={session.id} />
      <input type="hidden" name="placementId" value={placement?.id ?? ""} />
      <input type="hidden" name="expectedVersion" value={placement?.version ?? 0} />
      <input type="hidden" name="conflictPolicy" value={policy} />
      <Card>
        <CardHeader>
          <CardTitle>{placement ? `Edit ${session.title}` : `Schedule ${session.title}`}</CardTitle>
          <CardDescription>
            Times use {event.timezone}. Speaker conflicts follow the session’s current participants.
          </CardDescription>
          <CardAction>
            <Badge variant={placement ? "secondary" : "outline"}>{placement ? "Scheduled" : "Unscheduled"}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {state.status === "error" ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Placement not saved</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          {state.status === "conflict" && !state.confirmationRequired ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Resolve {conflicts.length === 1 ? "this conflict" : "these conflicts"}</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {conflicts.map((conflict) => (
                    <li
                      key={`${conflict.type}-${conflict.resourceId}-${conflict.placementIds.join("-")}-${conflict.startsAt}`}
                    >
                      {conflictLabel(conflict, session, sessions, rooms, tracks, event.timezone)}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={Boolean(fieldError(state, "startsAt")) || undefined}>
                <FieldLabel htmlFor={`${formId}-starts-at`}>Starts at</FieldLabel>
                <DateTimePicker
                  id={`${formId}-starts-at`}
                  name="startsAt"
                  value={startsAt}
                  onChange={setStartsAt}
                  aria-invalid={Boolean(fieldError(state, "startsAt")) || undefined}
                />
                <FieldError>{fieldError(state, "startsAt")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(fieldError(state, "durationMinutes")) || undefined}>
                <FieldLabel htmlFor={`${formId}-duration`}>Duration (minutes)</FieldLabel>
                <Input
                  id={`${formId}-duration`}
                  name="durationMinutes"
                  type="number"
                  min={1}
                  max={1440}
                  step={1}
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                  aria-invalid={Boolean(fieldError(state, "durationMinutes")) || undefined}
                  required
                />
                <FieldError>{fieldError(state, "durationMinutes")}</FieldError>
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={Boolean(fieldError(state, "roomId")) || undefined}>
                <FieldLabel htmlFor={`${formId}-room`}>Room</FieldLabel>
                <Select name="roomId" value={roomId} onValueChange={setRoomId}>
                  <SelectTrigger
                    id={`${formId}-room`}
                    className="w-full"
                    aria-invalid={Boolean(fieldError(state, "roomId")) || undefined}
                  >
                    <SelectValue placeholder="Choose a room" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {rooms.map((room) => (
                        <SelectItem key={room.id} value={room.id}>
                          {room.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError>{fieldError(state, "roomId")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(fieldError(state, "trackId")) || undefined}>
                <FieldLabel htmlFor={`${formId}-track`}>Track</FieldLabel>
                <Select name="trackId" value={trackId} onValueChange={setTrackId}>
                  <SelectTrigger
                    id={`${formId}-track`}
                    className="w-full"
                    aria-invalid={Boolean(fieldError(state, "trackId")) || undefined}
                  >
                    <SelectValue placeholder="No track" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      <SelectItem value="unassigned">No track</SelectItem>
                      {tracks.map((track) => (
                        <SelectItem key={track.id} value={track.id}>
                          {track.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError>{fieldError(state, "trackId")}</FieldError>
              </Field>
            </div>
            <FieldSet>
              <FieldLegend variant="label">Conflict policy</FieldLegend>
              <ToggleGroup
                type="single"
                value={policy}
                onValueChange={(value) => {
                  if (value) setPolicy(value as ConflictPolicy);
                }}
                variant="outline"
                size="sm"
                className="flex-wrap"
                aria-label="Conflict policy"
              >
                <ToggleGroupItem value="prevent">Prevent conflicts</ToggleGroupItem>
                <ToggleGroupItem value="explicit-confirm">Allow after confirmation</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                Validation always runs before save. Confirmation mode previews every conflict before persisting.
              </FieldDescription>
            </FieldSet>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {state.status === "success" ? state.message : null}
          </p>
          <Button type="submit" disabled={pending || rooms.length === 0}>
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {saveButtonLabel(pending, placement !== null)}
          </Button>
        </CardFooter>
      </Card>

      <AlertDialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Save with {conflicts.length} agenda {conflicts.length === 1 ? "conflict" : "conflicts"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The policy allows conflicts only after you review and explicitly confirm them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {conflicts.map((conflict) => (
              <li
                key={`${conflict.type}-${conflict.resourceId}-${conflict.placementIds.join("-")}-${conflict.startsAt}`}
              >
                {conflictLabel(conflict, session, sessions, rooms, tracks, event.timezone)}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction type="submit" name="conflictsConfirmed" value="true" form={formId}>
              Confirm and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

export function AgendaWorkspace({ event, sessions, rooms, tracks }: AgendaWorkspaceProps) {
  const [filter, setFilter] = useState<AgendaFilter>("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [removeMessage, setRemoveMessage] = useState("");
  const [removePending, startRemoveTransition] = useTransition();
  const selectedSession = sessions.find(({ id }) => id === selectedSessionId) ?? null;

  const removeSelected = () => {
    const placement = selectedSession?.placement;
    if (!placement) return;
    startRemoveTransition(async () => {
      const result = await removeAgendaPlacement(event.slug, placement.id, placement.version);
      setRemoveMessage(result.message ?? "");
      if (result.status === "success") setSelectedSessionId(null);
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">Agenda</h1>
        <p className="text-muted-foreground text-sm">
          Schedule sessions in {event.timezone} from {formatInstant(event.startsAt, event.timezone)} to{" "}
          {formatInstant(event.endsAt, event.timezone)}.
        </p>
      </header>

      {rooms.length === 0 ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Add an event room before scheduling</AlertTitle>
          <AlertDescription>Agenda placements require an event-owned room.</AlertDescription>
        </Alert>
      ) : null}

      <AssistedSchedulingCard
        eventSlug={event.slug}
        timezone={event.timezone}
        unscheduledCount={sessions.filter(({ placement }) => placement === null).length}
        roomCount={rooms.length}
      />

      <AgendaScheduleBoard event={event} sessions={sessions} rooms={rooms} tracks={tracks} />

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
        <AgendaViews
          event={event}
          sessions={sessions}
          rooms={rooms}
          tracks={tracks}
          filter={filter}
          onFilterChange={setFilter}
          onSelectSession={setSelectedSessionId}
        />

        <div className="flex min-w-0 flex-col gap-3">
          {selectedSession ? (
            <PlacementForm
              key={selectedSession.id}
              event={event}
              session={selectedSession}
              sessions={sessions}
              rooms={rooms}
              tracks={tracks}
            />
          ) : (
            <Empty className="min-h-80 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarPlus />
                </EmptyMedia>
                <EmptyTitle>Choose a session</EmptyTitle>
                <EmptyDescription>Select a session to manage its agenda placement.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {selectedSession?.placement ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <p className="text-muted-foreground text-sm">
                Removing a placement returns the session to the unscheduled list.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" size="sm" disabled={removePending}>
                    {removePending ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
                    Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {selectedSession.title} from the agenda?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The session remains available and can be scheduled again later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={removeSelected}>
                      Remove placement
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {removeMessage}
          </p>
        </div>
      </div>
    </div>
  );
}
