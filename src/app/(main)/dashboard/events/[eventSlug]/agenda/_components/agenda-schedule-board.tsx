"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { GripVertical, MoveVertical, TriangleAlert } from "lucide-react";
import { Temporal } from "temporal-polyfill";

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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { type AgendaConflictState, type AgendaMutationState, saveAgendaPlacement } from "../actions";
import type { AgendaWorkspaceSession } from "./agenda-workspace";

type ConflictPolicy = "prevent" | "explicit-confirm";

interface AgendaScheduleBoardProps {
  readonly event: {
    readonly slug: string;
    readonly timezone: string;
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly sessions: readonly AgendaWorkspaceSession[];
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
}

interface Lane {
  readonly id: string;
  readonly roomId: string;
  readonly roomName: string;
  readonly trackId: string | null;
  readonly trackName: string;
}

interface PlacementChange {
  readonly sessionId: string;
  readonly startsAt: string;
  readonly durationMinutes: number;
  readonly roomId: string;
  readonly trackId: string | null;
}

interface PendingConfirmation {
  readonly change: PlacementChange;
  readonly conflicts: readonly AgendaConflictState[];
}

const SNAP_MINUTES = 15;
const PIXELS_PER_MINUTE = 1.2;
const MIN_CARD_HEIGHT = 48;
const INITIAL_MUTATION_STATE: AgendaMutationState = { status: "idle" };

function snapMinutes(value: number): number {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
}

function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", { timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function formatDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function scheduleStatusLabel(
  dragPreview: PlacementChange | null,
  previewLane: Lane | null,
  pending: boolean,
  timezone: string,
): string {
  if (dragPreview && previewLane) {
    return `Preview: ${formatDateTime(dragPreview.startsAt, timezone)}, ${previewLane.roomName}, ${previewLane.trackName}`;
  }
  if (pending) return "Saving schedule change...";
  return "15-minute snap";
}

function toLocalDateTime(value: string, timezone: string): string {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}

function applyChange(
  sessions: readonly AgendaWorkspaceSession[],
  change: PlacementChange,
  timezone: string,
  minimumVersion?: number,
): readonly AgendaWorkspaceSession[] {
  return sessions.map((session) => {
    if (session.id !== change.sessionId || !session.placement) return session;
    const startsAt = new Date(change.startsAt);
    const endsAt = new Date(startsAt.getTime() + change.durationMinutes * 60_000);
    return {
      ...session,
      placement: {
        ...session.placement,
        startsAt: startsAt.toISOString(),
        startsAtLocal: toLocalDateTime(startsAt.toISOString(), timezone),
        endsAt: endsAt.toISOString(),
        durationMinutes: change.durationMinutes,
        roomId: change.roomId,
        trackId: change.trackId,
        version: Math.max(session.placement.version, minimumVersion ?? session.placement.version),
      },
    };
  });
}

function placementFormData(
  event: AgendaScheduleBoardProps["event"],
  session: AgendaWorkspaceSession,
  change: PlacementChange,
  policy: ConflictPolicy,
  conflictsConfirmed: boolean,
): FormData {
  const formData = new FormData();
  formData.set("eventSlug", event.slug);
  formData.set("sessionId", session.id);
  formData.set("placementId", session.placement?.id ?? "");
  formData.set("expectedVersion", String(session.placement?.version ?? 0));
  formData.set("startsAt", toLocalDateTime(change.startsAt, event.timezone));
  formData.set("durationMinutes", String(change.durationMinutes));
  formData.set("roomId", change.roomId);
  formData.set("trackId", change.trackId ?? "unassigned");
  formData.set("conflictPolicy", policy);
  formData.set("conflictsConfirmed", String(conflictsConfirmed));
  return formData;
}

function ScheduledCard({
  disabled,
  event,
  lane,
  onResize,
  session,
  timelineStart,
}: {
  readonly disabled: boolean;
  readonly event: AgendaScheduleBoardProps["event"];
  readonly lane: Lane;
  readonly onResize: (change: PlacementChange) => void;
  readonly session: AgendaWorkspaceSession;
  readonly timelineStart: number;
}) {
  const placement = session.placement;
  const resizeStart = useRef<{ pointerY: number; durationMinutes: number } | null>(null);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const { attributes, isDragging, listeners, setNodeRef, transform } = useDraggable({
    id: placement?.id ?? session.id,
    disabled: disabled || placement === null,
    data: { sessionId: session.id },
  });
  if (!placement) return null;

  const displayedDuration = previewDuration ?? placement.durationMinutes;
  const top = ((new Date(placement.startsAt).getTime() - timelineStart) / 60_000) * PIXELS_PER_MINUTE;
  const height = Math.max(displayedDuration * PIXELS_PER_MINUTE, MIN_CARD_HEIGHT);

  const finishResize = (pointerY: number) => {
    if (!resizeStart.current) return;
    const deltaMinutes = snapMinutes((pointerY - resizeStart.current.pointerY) / PIXELS_PER_MINUTE);
    const durationMinutes = Math.max(SNAP_MINUTES, resizeStart.current.durationMinutes + deltaMinutes);
    resizeStart.current = null;
    setPreviewDuration(null);
    if (durationMinutes !== placement.durationMinutes) {
      onResize({
        sessionId: session.id,
        startsAt: placement.startsAt,
        durationMinutes,
        roomId: lane.roomId,
        trackId: lane.trackId,
      });
    }
  };

  return (
    <div
      ref={setNodeRef}
      data-agenda-session={session.id}
      style={{
        height,
        top,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      className={cn(
        "absolute right-2 left-2 flex touch-none flex-col overflow-hidden rounded-lg border bg-card shadow-sm",
        isDragging && "opacity-30",
      )}
    >
      <button
        type="button"
        className="flex min-h-0 flex-1 cursor-grab items-start gap-1.5 p-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
        aria-label={`Move ${session.title}, ${formatDateTime(placement.startsAt, event.timezone)}, ${lane.roomName}, ${lane.trackName}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium text-xs">{session.title}</span>
          <span className="truncate text-muted-foreground text-xs">
            {formatTime(placement.startsAt, event.timezone)} · {displayedDuration} min
          </span>
        </div>
      </button>
      <button
        type="button"
        className="flex h-5 shrink-0 cursor-ns-resize touch-none items-center justify-center border-t bg-muted/50 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Resize ${session.title}`}
        disabled={disabled}
        onPointerDown={(pointerEvent) => {
          pointerEvent.stopPropagation();
          pointerEvent.currentTarget.setPointerCapture?.(pointerEvent.pointerId);
          resizeStart.current = { pointerY: pointerEvent.clientY, durationMinutes: placement.durationMinutes };
        }}
        onPointerMove={(pointerEvent) => {
          if (!resizeStart.current) return;
          const deltaMinutes = snapMinutes((pointerEvent.clientY - resizeStart.current.pointerY) / PIXELS_PER_MINUTE);
          setPreviewDuration(Math.max(SNAP_MINUTES, resizeStart.current.durationMinutes + deltaMinutes));
        }}
        onPointerUp={(pointerEvent) => finishResize(pointerEvent.clientY)}
        onPointerCancel={() => {
          resizeStart.current = null;
          setPreviewDuration(null);
        }}
      >
        <MoveVertical aria-hidden="true" />
      </button>
    </div>
  );
}

function TimelineLane({
  disabled,
  event,
  lane,
  onResize,
  sessions,
  timelineMinutes,
  timelineStart,
}: {
  readonly disabled: boolean;
  readonly event: AgendaScheduleBoardProps["event"];
  readonly lane: Lane;
  readonly onResize: (change: PlacementChange) => void;
  readonly sessions: readonly AgendaWorkspaceSession[];
  readonly timelineMinutes: number;
  readonly timelineStart: number;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: lane.id, disabled });
  const hourLines = Array.from({ length: Math.ceil(timelineMinutes / 60) + 1 }, (_, index) => index * 60);
  const laneSessions = sessions.filter(
    ({ placement }) => placement?.roomId === lane.roomId && (placement.trackId ?? null) === lane.trackId,
  );

  return (
    <div className="w-60 shrink-0 border-r last:border-r-0">
      <div className="sticky top-0 flex h-16 flex-col justify-center gap-1 border-b bg-card px-3">
        <span className="truncate font-medium text-sm">{lane.roomName}</span>
        <Badge variant="outline">{lane.trackName}</Badge>
      </div>
      <section
        ref={setNodeRef}
        data-agenda-lane={lane.id}
        className={cn("relative bg-background transition-colors", isOver && "bg-muted/60")}
        style={{ height: timelineMinutes * PIXELS_PER_MINUTE }}
        aria-label={`${lane.roomName}, ${lane.trackName} timeline`}
      >
        {hourLines.map((minute) => {
          const value = new Date(timelineStart + minute * 60_000).toISOString();
          return (
            <div key={minute} className="absolute right-0 left-0 border-t" style={{ top: minute * PIXELS_PER_MINUTE }}>
              <span className="ml-1 bg-background px-1 text-[0.65rem] text-muted-foreground">
                {formatTime(value, event.timezone)}
              </span>
            </div>
          );
        })}
        {laneSessions.map((session) => (
          <ScheduledCard
            key={session.id}
            disabled={disabled}
            event={event}
            lane={lane}
            onResize={onResize}
            session={session}
            timelineStart={timelineStart}
          />
        ))}
      </section>
    </div>
  );
}

export function AgendaScheduleBoard({ event, sessions, rooms, tracks }: AgendaScheduleBoardProps) {
  const [displayedSessions, setDisplayedSessions] = useState(sessions);
  const [policy, setPolicy] = useState<ConflictPolicy>("prevent");
  const [message, setMessage] = useState<{ status: "success" | "error"; text: string } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<PlacementChange | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [pending, startTransition] = useTransition();
  const timelineStart = new Date(event.startsAt).getTime();
  const timelineEnd = new Date(event.endsAt).getTime();
  const timelineMinutes = Math.max(SNAP_MINUTES, Math.ceil((timelineEnd - timelineStart) / 60_000));
  const lanes = useMemo(
    () =>
      rooms.flatMap((room) =>
        [{ id: null, name: "No track" }, ...tracks].map((track) => ({
          id: `${room.id}:${track.id ?? "unassigned"}`,
          roomId: room.id,
          roomName: room.name,
          trackId: track.id,
          trackName: track.name,
        })),
      ),
    [rooms, tracks],
  );
  const laneById = useMemo(() => new Map(lanes.map((lane) => [lane.id, lane])), [lanes]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => setDisplayedSessions(sessions), [sessions]);

  const changeForDrag = (sessionId: string, laneId: string | undefined, deltaY: number): PlacementChange | null => {
    const session = displayedSessions.find(({ id }) => id === sessionId);
    const placement = session?.placement;
    const currentLane = lanes.find(
      (lane) => lane.roomId === placement?.roomId && lane.trackId === (placement?.trackId ?? null),
    );
    const lane = (laneId ? laneById.get(laneId) : undefined) ?? currentLane;
    if (!session || !placement || !lane) return null;
    const deltaMinutes = snapMinutes(deltaY / PIXELS_PER_MINUTE);
    const unclampedStart = new Date(placement.startsAt).getTime() + deltaMinutes * 60_000;
    const latestStart = timelineEnd - placement.durationMinutes * 60_000;
    const startsAt = new Date(Math.max(timelineStart, Math.min(latestStart, unclampedStart))).toISOString();
    return {
      sessionId,
      startsAt,
      durationMinutes: placement.durationMinutes,
      roomId: lane.roomId,
      trackId: lane.trackId,
    };
  };

  const persistChange = (change: PlacementChange, conflictsConfirmed = false) => {
    const originalSessions = displayedSessions;
    const session = originalSessions.find(({ id }) => id === change.sessionId);
    if (!session?.placement) return;
    setDisplayedSessions(applyChange(originalSessions, change, event.timezone));
    setMessage(null);
    startTransition(async () => {
      const result = await saveAgendaPlacement(
        INITIAL_MUTATION_STATE,
        placementFormData(event, session, change, policy, conflictsConfirmed),
      );
      if (result.status === "success") {
        setDisplayedSessions((current) =>
          applyChange(current, change, event.timezone, session.placement ? session.placement.version + 1 : undefined),
        );
        setMessage({ status: "success", text: "Agenda placement saved." });
        setPendingConfirmation(null);
        return;
      }
      setDisplayedSessions(originalSessions);
      if (result.status === "conflict" && result.confirmationRequired && result.conflicts) {
        setPendingConfirmation({ change, conflicts: result.conflicts });
        setMessage({ status: "error", text: "The preview was reverted until you confirm these conflicts." });
        return;
      }
      setMessage({
        status: "error",
        text: `${result.message ?? "The agenda placement was not saved."} Change reverted.`,
      });
    });
  };

  const handleDragStart = (dragEvent: DragStartEvent) => {
    const sessionId = String(dragEvent.active.data.current?.sessionId ?? "");
    setActiveSessionId(sessionId || null);
  };
  const handleDragMove = (dragEvent: DragMoveEvent) => {
    if (!activeSessionId) return;
    setDragPreview(changeForDrag(activeSessionId, String(dragEvent.over?.id ?? ""), dragEvent.delta.y));
  };
  const clearDrag = () => {
    setActiveSessionId(null);
    setDragPreview(null);
  };
  const handleDragCancel = (_dragEvent: DragCancelEvent) => clearDrag();
  const handleDragEnd = (dragEvent: DragEndEvent) => {
    const sessionId = String(dragEvent.active.data.current?.sessionId ?? activeSessionId ?? "");
    const change = changeForDrag(sessionId, dragEvent.over ? String(dragEvent.over.id) : undefined, dragEvent.delta.y);
    clearDrag();
    if (dragEvent.over && change) persistChange(change);
  };
  const activeSession = displayedSessions.find(({ id }) => id === activeSessionId) ?? null;
  const previewLane =
    (dragPreview
      ? lanes.find((lane) => lane.roomId === dragPreview.roomId && lane.trackId === dragPreview.trackId)
      : null) ?? null;

  if (rooms.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Interactive schedule</CardTitle>
        <CardDescription>
          Drag sessions between room and track lanes or use the lower handle to resize. Changes snap to 15-minute
          increments and save when released.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ToggleGroup
            type="single"
            value={policy}
            onValueChange={(value) => {
              if (value) setPolicy(value as ConflictPolicy);
            }}
            variant="outline"
            size="sm"
            aria-label="Interactive schedule conflict policy"
          >
            <ToggleGroupItem value="prevent">Prevent conflicts</ToggleGroupItem>
            <ToggleGroupItem value="explicit-confirm">Confirm conflicts</ToggleGroupItem>
          </ToggleGroup>
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {scheduleStatusLabel(dragPreview, previewLane, pending, event.timezone)}
          </p>
        </div>

        {message ? (
          <Alert variant={message.status === "error" ? "destructive" : "default"}>
            {message.status === "error" ? <TriangleAlert /> : null}
            <AlertTitle>{message.status === "error" ? "Schedule change not saved" : "Schedule updated"}</AlertTitle>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        ) : null}

        <DndContext
          id="agenda-schedule-board"
          sensors={sensors}
          collisionDetection={pointerWithin}
          autoScroll
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            data-agenda-scroll
            className="max-h-[40rem] min-w-0 overflow-auto rounded-lg border [scrollbar-color:var(--border)_transparent]"
          >
            <div className="flex min-w-max">
              {lanes.map((lane) => (
                <TimelineLane
                  key={lane.id}
                  disabled={pending}
                  event={event}
                  lane={lane}
                  onResize={persistChange}
                  sessions={displayedSessions}
                  timelineMinutes={timelineMinutes}
                  timelineStart={timelineStart}
                />
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeSession?.placement ? (
              <div className="w-56 rounded-lg border bg-card p-3 shadow-lg">
                <p className="truncate font-medium text-sm">{activeSession.title}</p>
                <p className="text-muted-foreground text-xs">
                  {dragPreview ? formatDateTime(dragPreview.startsAt, event.timezone) : "Moving..."}
                </p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </CardContent>

      <AlertDialog open={pendingConfirmation !== null} onOpenChange={(open) => !open && setPendingConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save this schedule change with conflicts?</AlertDialogTitle>
            <AlertDialogDescription>
              The preview was reverted. Review the conflicts, then explicitly confirm to apply the change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {pendingConfirmation?.conflicts.map((conflict) => (
              <li key={`${conflict.type}-${conflict.resourceId}-${conflict.startsAt}`}>{conflict.explanation}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep original placement</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingConfirmation) persistChange(pendingConfirmation.change, true);
              }}
            >
              Confirm and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
