"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { CalendarDays, MapPin, Search, TriangleAlert, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { EmbedDensity, EmbedFilter } from "@/lib/published-embeds/configuration";
import { cn } from "@/lib/utils";

/**
 * One schedulable unit of the published program. The identifier is the
 * placement identifier, not the session identifier, so a session scheduled
 * twice stays two independently selectable entries.
 */
export interface ItinerarySession {
  readonly id: string;
  readonly sessionId: string;
  readonly title: string;
  readonly description: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly room: string | null;
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
  readonly speakers: readonly string[];
}

interface ItineraryWorkspaceProps {
  readonly density: EmbedDensity;
  readonly enabledFilters: readonly EmbedFilter[];
  readonly eventName: string;
  readonly sessions: readonly ItinerarySession[];
  readonly storageKey: string;
  readonly timezone: string;
}

function dayKey(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatDay(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
    weekday: "short",
  }).format(new Date(value));
}

function formatClock(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(
    new Date(value),
  );
}

function formatZoneAbbreviation(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(new Date(value));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

/**
 * Renders the local wall-clock range plus the zone abbreviation for the start
 * instant, so an attendee reading the embed from another region still knows
 * which zone the times belong to.
 */
function formatRange(session: ItinerarySession, timezone: string): string {
  return `${formatDay(session.startsAt, timezone)}, ${formatClock(session.startsAt, timezone)}–${formatClock(
    session.endsAt,
    timezone,
  )} ${formatZoneAbbreviation(session.startsAt, timezone)}`;
}

export function sessionsOverlap(first: ItinerarySession, second: ItinerarySession): boolean {
  return (
    Date.parse(first.startsAt) < Date.parse(second.endsAt) && Date.parse(second.startsAt) < Date.parse(first.endsAt)
  );
}

/**
 * Storage access is guarded because this widget runs as a third-party iframe:
 * a host page that sandboxes the frame, or a browser that blocks partitioned
 * storage, makes `window.localStorage` throw on access rather than return
 * null. Losing persistence there is acceptable; crashing the embed is not.
 */
function readStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable or over quota; the selection stays in memory.
  }
}

function readStoredIds(value: string | null): readonly string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((entry): entry is string => typeof entry === "string"))];
  } catch {
    return [];
  }
}

function matchesSearch(session: ItinerarySession, search: string): boolean {
  if (search === "") return true;
  return [session.title, session.description, session.room, ...session.speakers, ...session.tracks.map((t) => t.name)]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(search.toLocaleLowerCase());
}

function SessionSummary({ session, timezone }: { readonly session: ItinerarySession; readonly timezone: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <p className="font-medium leading-snug">{session.title}</p>
      <p className="text-muted-foreground text-sm">{formatRange(session, timezone)}</p>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        {session.room ? (
          <span className="inline-flex items-center gap-1">
            <MapPin aria-hidden="true" className="size-3.5" />
            {session.room}
          </span>
        ) : null}
        {session.tracks.map((track) => (
          <Badge key={track.id} variant="outline">
            {track.name}
          </Badge>
        ))}
      </div>
      {session.speakers.length > 0 ? (
        <p className="text-muted-foreground text-sm">{session.speakers.join(", ")}</p>
      ) : null}
    </div>
  );
}

export function ItineraryWorkspace({
  density,
  enabledFilters,
  eventName,
  sessions,
  storageKey,
  timezone,
}: ItineraryWorkspaceProps) {
  const showSearch = enabledFilters.includes("search");
  const showTrack = enabledFilters.includes("track");
  const showDay = enabledFilters.includes("day");

  const sessionsById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [restored, setRestored] = useState(false);
  const [droppedCount, setDroppedCount] = useState(0);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [trackId, setTrackId] = useState("");
  const [day, setDay] = useState("");

  // Restore on mount and again whenever a republish changes the program, so a
  // saved selection pointing at removed sessions reconciles instead of
  // rendering blanks. Nothing is written back to the server.
  useEffect(() => {
    const stored = readStoredIds(readStoredValue(storageKey));
    const available = stored.filter((id) => sessionsById.has(id));
    setSelectedIds(available);
    setDroppedCount(stored.length - available.length);
    setRestored(true);
  }, [sessionsById, storageKey]);

  useEffect(() => {
    if (!restored) return;
    writeStoredValue(storageKey, JSON.stringify(selectedIds));
  }, [restored, selectedIds, storageKey]);

  const days = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const session of sessions) {
      const key = dayKey(session.startsAt, timezone);
      if (!byKey.has(key)) byKey.set(key, session.startsAt);
    }
    return [...byKey.entries()].sort(([first], [second]) => first.localeCompare(second));
  }, [sessions, timezone]);

  const tracks = useMemo(
    () =>
      [...new Map(sessions.flatMap((session) => session.tracks.map((track) => [track.id, track] as const))).values()]
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [sessions],
  );

  const selectedSessions = useMemo(
    () =>
      selectedIds
        .flatMap((id) => {
          const session = sessionsById.get(id);
          return session ? [session] : [];
        })
        .sort((first, second) => first.startsAt.localeCompare(second.startsAt)),
    [selectedIds, sessionsById],
  );

  const conflictingIds = useMemo(() => {
    const conflicts = new Set<string>();
    for (const [index, session] of selectedSessions.entries()) {
      for (const other of selectedSessions.slice(index + 1)) {
        if (sessionsOverlap(session, other)) {
          conflicts.add(session.id);
          conflicts.add(other.id);
        }
      }
    }
    return conflicts;
  }, [selectedSessions]);

  const visibleSessions = sessions.filter(
    (session) =>
      matchesSearch(session, showSearch ? search.trim() : "") &&
      (!showTrack || !trackId || session.tracks.some((track) => track.id === trackId)) &&
      (!showDay || !day || dayKey(session.startsAt, timezone) === day),
  );

  const toggleSession = (session: ItinerarySession, selected: boolean) => {
    if (!selected) {
      setSelectedIds((current) => current.filter((id) => id !== session.id));
      setStatus(`${session.title} removed from your itinerary.`);
      return;
    }
    setSelectedIds((current) => (current.includes(session.id) ? current : [...current, session.id]));
    const clash = selectedSessions.find((candidate) => sessionsOverlap(candidate, session));
    setStatus(
      clash
        ? `${session.title} added to your itinerary. It overlaps with ${clash.title}.`
        : `${session.title} added to your itinerary.`,
    );
  };

  const filtersVisible = showSearch || (showTrack && tracks.length > 0) || (showDay && days.length > 1);

  // Rendered before the tree so the three itinerary states stay readable
  // rather than collapsing into nested ternaries.
  let selection: ReactNode;
  if (!restored) {
    // Server and first client render agree on this placeholder; the saved
    // selection only exists in localStorage, which the server cannot read.
    selection = <p className="text-muted-foreground text-sm">Loading your saved itinerary…</p>;
  } else if (selectedSessions.length > 0) {
    selection = (
      <ol className="flex flex-col gap-2">
        {selectedSessions.map((session) => (
          <li className="flex items-start gap-2 rounded-lg border p-3" key={session.id}>
            <SessionSummary session={session} timezone={timezone} />
            <div className="flex shrink-0 flex-col items-end gap-1">
              {conflictingIds.has(session.id) ? <Badge variant="outline">Overlaps</Badge> : null}
              <Button
                aria-label={`Remove ${session.title} from itinerary`}
                onClick={() => toggleSession(session, false)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
          </li>
        ))}
      </ol>
    );
  } else {
    selection = (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays />
          </EmptyMedia>
          <EmptyTitle>Your itinerary is empty</EmptyTitle>
          <EmptyDescription>
            Select a published session to add it here. Nothing is sent to the organizer.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section aria-labelledby="itinerary-title" className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{eventName}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight" id="itinerary-title">
          Itinerary
        </h1>
        <p className="text-muted-foreground text-sm">
          Choose published sessions to build a personal schedule. Times are shown in {timezone}, and your selection is
          stored only in this browser.
        </p>
      </header>

      {/* Always rendered so assistive technology has a live region to announce into. */}
      <p aria-live="polite" className="sr-only" role="status">
        {status}
      </p>

      {sessions.length === 0 ? (
        <Card size={density === "compact" ? "sm" : "default"}>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarDays />
                </EmptyMedia>
                <EmptyTitle>No scheduled sessions</EmptyTitle>
                <EmptyDescription>
                  Sessions appear here once the organizer publishes a program with a schedule.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div
          className={cn(
            "grid min-w-0 items-start gap-4",
            density === "compact" ? "lg:grid-cols-2" : "lg:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)]",
          )}
        >
          <Card size={density === "compact" ? "sm" : "default"}>
            <CardHeader>
              <CardTitle>Published sessions</CardTitle>
              <CardDescription>Select the sessions you plan to attend.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {filtersVisible ? (
                <FieldGroup className="rounded-xl border bg-card p-3 sm:flex-row sm:items-end">
                  {showSearch ? (
                    <Field>
                      <FieldLabel htmlFor="itinerary-search">Search sessions</FieldLabel>
                      <div className="relative">
                        <Search
                          aria-hidden="true"
                          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          className="pl-8"
                          id="itinerary-search"
                          onChange={(event) => setSearch(event.currentTarget.value)}
                          placeholder="Title, speaker, room, or track"
                          type="search"
                          value={search}
                        />
                      </div>
                    </Field>
                  ) : null}
                  {showDay && days.length > 1 ? (
                    <Field className="sm:max-w-48">
                      <FieldLabel htmlFor="itinerary-day">Day</FieldLabel>
                      <NativeSelect
                        className="w-full"
                        id="itinerary-day"
                        onChange={(event) => setDay(event.currentTarget.value)}
                        value={day}
                      >
                        <NativeSelectOption value="">All days</NativeSelectOption>
                        {days.map(([key, startsAt]) => (
                          <NativeSelectOption key={key} value={key}>
                            {formatDay(startsAt, timezone)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : null}
                  {showTrack && tracks.length > 0 ? (
                    <Field className="sm:max-w-48">
                      <FieldLabel htmlFor="itinerary-track">Track</FieldLabel>
                      <NativeSelect
                        className="w-full"
                        id="itinerary-track"
                        onChange={(event) => setTrackId(event.currentTarget.value)}
                        value={trackId}
                      >
                        <NativeSelectOption value="">All tracks</NativeSelectOption>
                        {tracks.map((track) => (
                          <NativeSelectOption key={track.id} value={track.id}>
                            {track.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : null}
                </FieldGroup>
              ) : null}

              {visibleSessions.length > 0 ? (
                <ul aria-label="Published sessions" className="flex flex-col gap-2">
                  {visibleSessions.map((session) => {
                    const checked = selectedIds.includes(session.id);
                    const checkboxId = `itinerary-session-${session.id}`;
                    return (
                      <li key={session.id}>
                        <FieldLabel
                          className="w-full cursor-pointer items-start rounded-lg border p-3"
                          htmlFor={checkboxId}
                        >
                          <Checkbox
                            aria-label={`${checked ? "Remove" : "Add"} ${session.title} ${
                              checked ? "from" : "to"
                            } itinerary`}
                            checked={checked}
                            className="mt-1"
                            id={checkboxId}
                            onCheckedChange={(value) => toggleSession(session, value === true)}
                          />
                          <SessionSummary session={session} timezone={timezone} />
                        </FieldLabel>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Search />
                    </EmptyMedia>
                    <EmptyTitle>No matching sessions</EmptyTitle>
                    <EmptyDescription>Try a different search, day, or track.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card
            aria-label="My itinerary"
            className="lg:sticky lg:top-4"
            role="region"
            size={density === "compact" ? "sm" : "default"}
          >
            <CardHeader>
              <CardTitle>My itinerary</CardTitle>
              <CardDescription>
                {selectedSessions.length === 1 ? "1 session" : `${selectedSessions.length} sessions`} · {timezone}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {droppedCount > 0 ? (
                <Alert>
                  <TriangleAlert />
                  <AlertTitle>Program updated</AlertTitle>
                  <AlertDescription>
                    {droppedCount === 1
                      ? "1 saved session is no longer in the published program and was removed."
                      : `${droppedCount} saved sessions are no longer in the published program and were removed.`}
                  </AlertDescription>
                </Alert>
              ) : null}
              {conflictingIds.size > 0 ? (
                <Alert>
                  <TriangleAlert />
                  <AlertTitle>Time conflict</AlertTitle>
                  <AlertDescription>
                    Some selected sessions overlap. Conflicting entries are marked below.
                  </AlertDescription>
                </Alert>
              ) : null}
              {selection}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
