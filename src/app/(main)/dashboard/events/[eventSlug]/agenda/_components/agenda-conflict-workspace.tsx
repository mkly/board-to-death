"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { AlertTriangle, CalendarCheck, RefreshCw, Save, Trash2 } from "lucide-react";

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
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useActionToast } from "@/hooks/use-action-toast";

import {
  type AgendaConflictState,
  type AgendaMutationState,
  removeAgendaPlacement,
  saveAgendaPlacement,
} from "../actions";

type ConflictType = "event-boundary" | "room" | "speaker" | "track";
type ConflictFilter = "all" | ConflictType;
type ConflictPolicy = "prevent" | "explicit-confirm";

export interface AgendaConflictPlacement {
  readonly id: string;
  readonly sessionId: string;
  readonly title: string;
  readonly roomId: string;
  readonly roomName: string;
  readonly startsAtLocal: string;
  readonly timeLabel: string;
  readonly durationMinutes: number;
  readonly trackId: string | null;
  readonly trackNames: readonly string[];
  readonly speakerIds: readonly string[];
  readonly speakerNames: readonly string[];
  readonly version: number;
}

export interface AgendaWorkspaceConflict {
  readonly id: string;
  readonly type: ConflictType;
  readonly placementIds: readonly string[];
  readonly summary: string;
  readonly overlapLabel: string;
  readonly resourceName: string | null;
}

interface AgendaConflictWorkspaceProps {
  readonly event: { readonly slug: string; readonly timezone: string };
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
  readonly placements: readonly AgendaConflictPlacement[];
  readonly conflicts: readonly AgendaWorkspaceConflict[];
}

const INITIAL_STATE: AgendaMutationState = { status: "idle" };
const conflictLabels: Readonly<Record<ConflictType, string>> = {
  "event-boundary": "Event boundary",
  room: "Room",
  track: "Track",
  speaker: "Speaker",
};

function formatInstant(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function mutationConflictLabel(
  conflict: AgendaConflictState,
  selected: AgendaConflictPlacement,
  placements: readonly AgendaConflictPlacement[],
  rooms: AgendaConflictWorkspaceProps["rooms"],
  tracks: AgendaConflictWorkspaceProps["tracks"],
  timezone: string,
): string {
  const otherPlacementId = conflict.placementIds.find((placementId) => placementId !== selected.id);
  const otherPlacement = placements.find(({ id }) => id === otherPlacementId);
  const overlap = `${formatInstant(conflict.startsAt, timezone)}–${new Intl.DateTimeFormat("en", {
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(conflict.endsAt))}`;
  if (conflict.type === "event-boundary") return `${selected.title} falls outside the event schedule (${overlap}).`;
  if (conflict.type === "room") {
    const room = rooms.find(({ id }) => id === conflict.resourceId)?.name ?? "Unknown room";
    return `${selected.title} and ${otherPlacement?.title ?? "another session"} overlap in room ${room} (${overlap}).`;
  }
  if (conflict.type === "track") {
    const track = tracks.find(({ id }) => id === conflict.resourceId)?.name ?? "Unknown track";
    return `${selected.title} and ${otherPlacement?.title ?? "another session"} overlap on track ${track} (${overlap}).`;
  }
  const speaker =
    selected.speakerNames.find((_, index) => selected.speakerIds[index] === conflict.resourceId) ??
    placements
      .flatMap((placement) => placement.speakerIds.map((id, index) => [id, placement.speakerNames[index]] as const))
      .find(([id]) => id === conflict.resourceId)?.[1] ??
    "Unknown speaker";
  return `${selected.title} and ${otherPlacement?.title ?? "another session"} overlap for speaker ${speaker} (${overlap}).`;
}

function PlacementEditor({
  event,
  placement,
  placements,
  rooms,
  tracks,
}: {
  readonly event: AgendaConflictWorkspaceProps["event"];
  readonly placement: AgendaConflictPlacement;
  readonly placements: AgendaConflictWorkspaceProps["placements"];
  readonly rooms: AgendaConflictWorkspaceProps["rooms"];
  readonly tracks: AgendaConflictWorkspaceProps["tracks"];
}) {
  const [state, formAction, pending] = useActionState(saveAgendaPlacement, INITIAL_STATE);
  const [removeState, setRemoveState] = useState<AgendaMutationState>(INITIAL_STATE);
  const [removePending, startRemoveTransition] = useTransition();
  const [startsAt, setStartsAt] = useState(placement.startsAtLocal);
  const [duration, setDuration] = useState(String(placement.durationMinutes));
  const [policy, setPolicy] = useState<ConflictPolicy>("prevent");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const formId = `conflict-placement-form-${placement.id}`;
  useActionToast(state);
  useActionToast(removeState);

  useEffect(() => {
    setStartsAt(placement.startsAtLocal);
    setDuration(String(placement.durationMinutes));
  }, [placement.durationMinutes, placement.startsAtLocal]);

  useEffect(() => {
    setConfirmationOpen(state.status === "conflict" && state.confirmationRequired === true);
    if (state.values) {
      setStartsAt(state.values.startsAt);
      setDuration(state.values.durationMinutes);
      setPolicy(state.values.conflictPolicy);
    }
  }, [state]);

  const remove = () => {
    startRemoveTransition(async () => {
      setRemoveState(await removeAgendaPlacement(event.slug, placement.id, placement.version));
    });
  };
  const mutationConflicts = state.conflicts ?? [];

  return (
    <Card id={`conflict-placement-${placement.id}`} size="sm" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>{placement.title}</CardTitle>
        <CardDescription>
          {placement.timeLabel} · {placement.roomName}
        </CardDescription>
        <CardAction>
          <Badge variant="outline">v{placement.version}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {placement.trackNames.map((track) => (
            <Badge key={track} variant="secondary">
              {track}
            </Badge>
          ))}
          {placement.speakerNames.map((speaker) => (
            <Badge key={speaker} variant="outline">
              {speaker}
            </Badge>
          ))}
        </div>
        {state.status === "conflict" && !state.confirmationRequired ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Other conflicts remain</AlertTitle>
            <AlertDescription>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {mutationConflicts.map((conflict) => (
                  <li key={`${conflict.type}-${conflict.resourceId}-${conflict.placementIds.join("-")}`}>
                    {mutationConflictLabel(conflict, placement, placements, rooms, tracks, event.timezone)}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        <form noValidate id={formId} action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="eventSlug" value={event.slug} />
          <input type="hidden" name="sessionId" value={placement.sessionId} />
          <input type="hidden" name="placementId" value={placement.id} />
          <input type="hidden" name="expectedVersion" value={placement.version} />
          <input type="hidden" name="roomId" value={placement.roomId} />
          <input type="hidden" name="trackId" value={placement.trackId ?? "unassigned"} />
          <input type="hidden" name="conflictPolicy" value={policy} />
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(state.errors?.startsAt?.[0]) || undefined}>
                <FieldLabel htmlFor={`conflict-placement-start-${placement.id}`}>Start time</FieldLabel>
                <DateTimePicker
                  id={`conflict-placement-start-${placement.id}`}
                  name="startsAt"
                  value={startsAt}
                  onChange={setStartsAt}
                  aria-invalid={Boolean(state.errors?.startsAt?.[0]) || undefined}
                />
              </Field>
              <Field data-invalid={Boolean(state.errors?.durationMinutes?.[0]) || undefined}>
                <FieldLabel htmlFor={`conflict-placement-duration-${placement.id}`}>Duration (minutes)</FieldLabel>
                <Input
                  id={`conflict-placement-duration-${placement.id}`}
                  name="durationMinutes"
                  type="number"
                  min={1}
                  max={1440}
                  step={1}
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  aria-invalid={Boolean(state.errors?.durationMinutes?.[0]) || undefined}
                  required
                />
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
                aria-label={`Conflict policy for ${placement.title}`}
              >
                <ToggleGroupItem value="prevent">Prevent conflicts</ToggleGroupItem>
                <ToggleGroupItem value="explicit-confirm">Allow after confirmation</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                Use confirmation mode when this edit resolves one conflict but intentionally leaves another.
              </FieldDescription>
            </FieldSet>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={pending || removePending}>
                <Trash2 data-icon="inline-start" />
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {placement.title} from the agenda?</AlertDialogTitle>
                <AlertDialogDescription>
                  The session remains available, but this placement and its conflicts will be removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={remove}>
                  Remove placement
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button type="submit" form={formId} disabled={pending || removePending}>
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            Save placement
          </Button>
        </div>
      </CardFooter>

      <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Save with {mutationConflicts.length} remaining {mutationConflicts.length === 1 ? "conflict" : "conflicts"}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This can resolve part of the agenda while preserving the conflicts listed below for later review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {mutationConflicts.map((conflict) => (
              <li key={`${conflict.type}-${conflict.resourceId}-${conflict.placementIds.join("-")}`}>
                {mutationConflictLabel(conflict, placement, placements, rooms, tracks, event.timezone)}
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
    </Card>
  );
}

export function AgendaConflictWorkspace({ event, placements, conflicts, rooms, tracks }: AgendaConflictWorkspaceProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<ConflictFilter>("all");
  const [refreshPending, startRefreshTransition] = useTransition();
  const placementTitles = useMemo(() => new Map(placements.map(({ id, title }) => [id, title])), [placements]);
  const visibleConflicts = conflicts.filter((conflict) => filter === "all" || conflict.type === filter);
  const visiblePlacementIds = new Set(visibleConflicts.flatMap((conflict) => conflict.placementIds));
  const visiblePlacements = placements.filter((placement) => visiblePlacementIds.has(placement.id));
  const groupedConflicts = Object.entries(
    Object.groupBy(visibleConflicts, (conflict) => conflict.type) as Partial<
      Record<ConflictType, AgendaWorkspaceConflict[]>
    >,
  ) as [ConflictType, AgendaWorkspaceConflict[]][];

  const refresh = () => {
    startRefreshTransition(() => router.refresh());
  };

  return (
    <section aria-labelledby="conflict-review-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="conflict-review-heading" className="font-heading font-semibold text-xl tracking-tight">
            Conflict review
          </h2>
          <p className="text-muted-foreground text-sm">
            Review current collisions in {event.timezone}, then edit or remove an affected placement.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={refresh} disabled={refreshPending}>
          {refreshPending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          Refresh conflicts
        </Button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-heading font-medium text-lg">Current conflicts</h3>
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {visibleConflicts.length} of {conflicts.length} {conflicts.length === 1 ? "conflict" : "conflicts"}
          </p>
        </div>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as ConflictFilter);
          }}
          variant="outline"
          size="sm"
          className="max-w-full flex-wrap"
          aria-label="Filter agenda conflicts"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="event-boundary">Boundary</ToggleGroupItem>
          <ToggleGroupItem value="room">Room</ToggleGroupItem>
          <ToggleGroupItem value="track">Track</ToggleGroupItem>
          <ToggleGroupItem value="speaker">Speaker</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {visibleConflicts.length === 0 ? (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarCheck />
            </EmptyMedia>
            <EmptyTitle>{conflicts.length === 0 ? "No agenda conflicts" : "No conflicts match this filter"}</EmptyTitle>
            <EmptyDescription>
              {conflicts.length === 0
                ? "Every current placement fits the event and its assigned resources."
                : "Choose another conflict type to continue reviewing the agenda."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-5">
            {groupedConflicts.map(([type, typeConflicts]) => (
              <section key={type} aria-labelledby={`conflict-group-${type}`} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h3 id={`conflict-group-${type}`} className="font-heading font-medium">
                    {conflictLabels[type]}
                  </h3>
                  <Badge variant="secondary">{typeConflicts.length}</Badge>
                </div>
                {typeConflicts.map((conflict) => (
                  <Alert key={conflict.id}>
                    <AlertTriangle />
                    <AlertTitle>
                      {conflict.resourceName
                        ? `${conflictLabels[type]}: ${conflict.resourceName}`
                        : conflictLabels[type]}
                    </AlertTitle>
                    <AlertDescription className="flex flex-col gap-2">
                      <p>{conflict.summary}</p>
                      <p>Overlap: {conflict.overlapLabel}.</p>
                      <span className="flex flex-wrap gap-3">
                        {conflict.placementIds.map((placementId) => (
                          <a key={placementId} href={`#conflict-placement-${placementId}`}>
                            Review {placementTitles.get(placementId) ?? "placement"}
                          </a>
                        ))}
                      </span>
                    </AlertDescription>
                  </Alert>
                ))}
              </section>
            ))}
          </div>

          <section aria-labelledby="conflicted-placements-heading" className="flex flex-col gap-4">
            <div>
              <h3 id="conflicted-placements-heading" className="font-heading font-medium text-lg">
                Affected placements
              </h3>
              <p className="text-muted-foreground text-sm">
                Every save uses the agenda editor’s server validation and conflict policy.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {visiblePlacements.map((placement) => (
                <PlacementEditor
                  key={placement.id}
                  event={event}
                  placement={placement}
                  placements={placements}
                  rooms={rooms}
                  tracks={tracks}
                />
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
