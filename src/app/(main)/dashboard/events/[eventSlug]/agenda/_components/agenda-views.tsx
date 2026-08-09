"use client";

import { useMemo, useState } from "react";

import Link from "next/link";

import { CalendarClock, ChevronLeft, ChevronRight, Clock3, Download } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { AgendaWorkspaceSession } from "./agenda-workspace";

type AgendaView = "list" | "day" | "week" | "month" | "track" | "room";
export type AgendaFilter = "all" | "scheduled" | "unscheduled";

interface AgendaViewsProps {
  readonly event: { readonly slug: string; readonly timezone: string; readonly startsAt: string };
  readonly sessions: readonly AgendaWorkspaceSession[];
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
  readonly filter: AgendaFilter;
  readonly onFilterChange: (filter: AgendaFilter) => void;
  readonly onSelectSession: (sessionId: string) => void;
}

function localDate(value: string, timezone: string): Temporal.PlainDate {
  return Temporal.Instant.from(value).toZonedDateTimeISO(timezone).toPlainDate();
}

function formatDate(date: Temporal.PlainDate, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(
    new Date(`${date.toString()}T00:00:00.000Z`),
  );
}

function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(
    new Date(value),
  );
}

function sessionTrackId(session: AgendaWorkspaceSession): string | null {
  return session.placement?.trackId ?? session.trackId;
}

function matchesFilters(
  session: AgendaWorkspaceSession,
  status: AgendaFilter,
  roomId: string,
  trackId: string,
): boolean {
  if (status === "scheduled" && !session.placement) return false;
  if (status === "unscheduled" && session.placement) return false;
  if (roomId !== "all" && session.placement?.roomId !== roomId) return false;
  if (trackId !== "all" && sessionTrackId(session) !== trackId) return false;
  return true;
}

function AgendaItem({
  event,
  session,
  onSelectSession,
  compact = false,
}: {
  readonly event: AgendaViewsProps["event"];
  readonly session: AgendaWorkspaceSession;
  readonly onSelectSession: AgendaViewsProps["onSelectSession"];
  readonly compact?: boolean;
}) {
  const placement = session.placement;
  return (
    <article
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
      data-parent-session={session.parentSessionId ?? undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/dashboard/events/${event.slug}/sessions?sessionId=${session.id}`}
            className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {session.title}
          </Link>
          <p className="text-muted-foreground text-xs">
            {placement
              ? `${formatTime(placement.startsAt, event.timezone)}–${formatTime(placement.endsAt, event.timezone)} ${event.timezone}`
              : `${session.durationMinutes} min · Not placed`}
          </p>
          {session.parentSessionTitle ? (
            <Badge variant="outline" className="w-fit">
              Subsession of {session.parentSessionTitle}
            </Badge>
          ) : null}
        </div>
        <Badge variant={placement ? "secondary" : "outline"}>{placement ? "Scheduled" : "Unscheduled"}</Badge>
      </div>
      {!compact ? (
        <div className="flex flex-col gap-1 text-muted-foreground text-xs">
          <p>
            {placement
              ? `${placement.roomName} · ${session.trackName ?? "No track"}`
              : (session.trackName ?? "No track")}
          </p>
          <p>{session.speakerNames.length > 0 ? session.speakerNames.join(", ") : "No speakers assigned"}</p>
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        aria-label={`${placement ? "Edit placement for" : "Schedule"} ${session.title}`}
        onClick={() => onSelectSession(session.id)}
      >
        <Clock3 data-icon="inline-start" />
        {placement ? "Edit" : "Schedule"}
      </Button>
    </article>
  );
}

function EmptyView({ description }: { readonly description: string }) {
  return (
    <Empty className="min-h-56 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarClock />
        </EmptyMedia>
        <EmptyTitle>No sessions in this view</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ItemGrid({
  event,
  sessions,
  onSelectSession,
}: {
  readonly event: AgendaViewsProps["event"];
  readonly sessions: readonly AgendaWorkspaceSession[];
  readonly onSelectSession: AgendaViewsProps["onSelectSession"];
}) {
  if (sessions.length === 0) return <EmptyView description="Change the date or filters to see other sessions." />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {sessions.map((session) => (
        <AgendaItem key={session.id} event={event} session={session} onSelectSession={onSelectSession} />
      ))}
    </div>
  );
}

function DateNavigation({
  label,
  onPrevious,
  onNext,
}: {
  readonly label: string;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Button type="button" variant="outline" size="icon-sm" aria-label="Previous period" onClick={onPrevious}>
        <ChevronLeft />
      </Button>
      <p className="font-medium text-sm">{label}</p>
      <Button type="button" variant="outline" size="icon-sm" aria-label="Next period" onClick={onNext}>
        <ChevronRight />
      </Button>
    </div>
  );
}

function GroupedView({
  event,
  sessions,
  groups,
  onSelectSession,
  groupBy,
}: {
  readonly event: AgendaViewsProps["event"];
  readonly sessions: readonly AgendaWorkspaceSession[];
  readonly groups: readonly { readonly id: string; readonly name: string }[];
  readonly onSelectSession: AgendaViewsProps["onSelectSession"];
  readonly groupBy: "room" | "track";
}) {
  const scheduled = sessions.filter((session) => session.placement);
  if (scheduled.length === 0) return <EmptyView description="Schedule a session or change the filters." />;
  const visibleGroups = [...groups, ...(groupBy === "track" ? [{ id: "unassigned", name: "No track" }] : [])].map(
    (group) => ({
      ...group,
      sessions: scheduled.filter((session) =>
        groupBy === "room"
          ? session.placement?.roomId === group.id
          : (sessionTrackId(session) ?? "unassigned") === group.id,
      ),
    }),
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {visibleGroups.map((group) => (
        <Card key={group.id}>
          <CardHeader>
            <CardTitle>
              <h3>{group.name}</h3>
            </CardTitle>
            <CardDescription>
              {group.sessions.length} {group.sessions.length === 1 ? "placement" : "placements"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {group.sessions.length === 0 ? (
              <p className="text-muted-foreground text-sm">No placements in this group.</p>
            ) : (
              group.sessions.map((session) => (
                <AgendaItem
                  key={session.id}
                  event={event}
                  session={session}
                  onSelectSession={onSelectSession}
                  compact
                />
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function exportHref(eventSlug: string, status: AgendaFilter, roomId: string, trackId: string): string {
  const query = new URLSearchParams();
  query.set("status", status);
  if (roomId !== "all") query.set("room", roomId);
  if (trackId !== "all") query.set("track", trackId);
  return `/dashboard/events/${eventSlug}/agenda/export?${query.toString()}`;
}

export function AgendaViews({
  event,
  sessions,
  rooms,
  tracks,
  filter,
  onFilterChange,
  onSelectSession,
}: AgendaViewsProps) {
  const [view, setView] = useState<AgendaView>("list");
  const [roomId, setRoomId] = useState("all");
  const [trackId, setTrackId] = useState("all");
  const [focusDate, setFocusDate] = useState(() => localDate(event.startsAt, event.timezone));
  const filteredSessions = useMemo(
    () => {
      const visible = sessions.filter((session) => matchesFilters(session, filter, roomId, trackId));
      const byId = new Map(visible.map((session) => [session.id, session]));
      return visible.toSorted((left, right) => {
        const leftRoot = left.parentSessionId && byId.has(left.parentSessionId) ? left.parentSessionId : left.id;
        const rightRoot = right.parentSessionId && byId.has(right.parentSessionId) ? right.parentSessionId : right.id;
        const rootOrder = sessions.findIndex(({ id }) => id === leftRoot) - sessions.findIndex(({ id }) => id === rightRoot);
        if (rootOrder !== 0) return rootOrder;
        if (left.parentSessionId === null) return -1;
        if (right.parentSessionId === null) return 1;
        return (left.placement?.startsAt ?? "").localeCompare(right.placement?.startsAt ?? "");
      });
    },
    [filter, roomId, sessions, trackId],
  );
  const scheduledSessions = filteredSessions.filter((session) => session.placement);
  const weekStart = focusDate.subtract({ days: focusDate.dayOfWeek - 1 });
  const monthStart = focusDate.with({ day: 1 });
  const calendarStart = monthStart.subtract({ days: monthStart.dayOfWeek - 1 });
  const days = Array.from({ length: 42 }, (_, index) => calendarStart.add({ days: index }));
  const sessionsForDate = (date: Temporal.PlainDate) =>
    scheduledSessions.filter(
      (session) => session.placement && localDate(session.placement.startsAt, event.timezone).equals(date),
    );
  const moveFocus = (direction: -1 | 1) => {
    if (view === "month") setFocusDate((date) => date.add({ months: direction }));
    else setFocusDate((date) => date.add({ days: direction * (view === "week" ? 7 : 1) }));
  };

  return (
    <Card className="min-w-0 self-start">
      <CardHeader>
        <CardTitle>Agenda views</CardTitle>
        <CardDescription>View persisted placements and manage sessions in {event.timezone}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <FieldGroup className="grid gap-3 md:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="agenda-status-filter">Status</FieldLabel>
            <Select value={filter} onValueChange={(value) => onFilterChange(value as AgendaFilter)}>
              <SelectTrigger id="agenda-status-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All sessions</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="unscheduled">Unscheduled</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="agenda-room-filter">Room</FieldLabel>
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger id="agenda-room-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All rooms</SelectItem>
                  {rooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {room.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="agenda-track-filter">Track</FieldLabel>
            <Select value={trackId} onValueChange={setTrackId}>
              <SelectTrigger id="agenda-track-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All tracks</SelectItem>
                  {tracks.map((track) => (
                    <SelectItem key={track.id} value={track.id}>
                      {track.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {filteredSessions.length} {filteredSessions.length === 1 ? "session" : "sessions"}
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href={exportHref(event.slug, filter, roomId, trackId)}>
              <Download data-icon="inline-start" />
              Export filtered CSV
            </a>
          </Button>
        </div>

        <Tabs value={view} onValueChange={(value) => setView(value as AgendaView)}>
          <TabsList className="grid h-auto w-full grid-cols-3 sm:grid-cols-6" aria-label="Agenda view">
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="track">Track</TabsTrigger>
            <TabsTrigger value="room">Room</TabsTrigger>
          </TabsList>
          <TabsContent value="list">
            <ItemGrid event={event} sessions={filteredSessions} onSelectSession={onSelectSession} />
          </TabsContent>
          <TabsContent value="day" className="flex flex-col gap-4">
            <DateNavigation
              label={formatDate(focusDate, { dateStyle: "full" })}
              onPrevious={() => moveFocus(-1)}
              onNext={() => moveFocus(1)}
            />
            <ItemGrid event={event} sessions={sessionsForDate(focusDate)} onSelectSession={onSelectSession} />
          </TabsContent>
          <TabsContent value="week" className="flex flex-col gap-4">
            <DateNavigation
              label={`${formatDate(weekStart, { month: "short", day: "numeric" })}–${formatDate(weekStart.add({ days: 6 }), { month: "short", day: "numeric", year: "numeric" })}`}
              onPrevious={() => moveFocus(-1)}
              onNext={() => moveFocus(1)}
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
              {Array.from({ length: 7 }, (_, index) => weekStart.add({ days: index })).map((date) => (
                <section key={date.toString()} className="flex min-w-0 flex-col gap-2 rounded-lg border p-2">
                  <h3 className="font-medium text-xs">
                    {formatDate(date, { weekday: "short", month: "short", day: "numeric" })}
                  </h3>
                  {sessionsForDate(date).length === 0 ? (
                    <p className="text-muted-foreground text-xs">No sessions</p>
                  ) : (
                    sessionsForDate(date).map((session) => (
                      <AgendaItem
                        key={session.id}
                        event={event}
                        session={session}
                        onSelectSession={onSelectSession}
                        compact
                      />
                    ))
                  )}
                </section>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="month" className="flex flex-col gap-4">
            <DateNavigation
              label={formatDate(monthStart, { month: "long", year: "numeric" })}
              onPrevious={() => moveFocus(-1)}
              onNext={() => moveFocus(1)}
            />
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
              {days.map((date) => {
                const items = sessionsForDate(date);
                return (
                  <section key={date.toString()} className="min-h-24 bg-card p-2">
                    <h3
                      className={
                        date.month === monthStart.month ? "font-medium text-xs" : "text-muted-foreground text-xs"
                      }
                    >
                      {date.day}
                    </h3>
                    <div className="mt-2 flex flex-col gap-1">
                      {items.map((session) => (
                        <Button
                          key={session.id}
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => onSelectSession(session.id)}
                        >
                          <span className="truncate">
                            {formatTime(session.placement?.startsAt ?? "", event.timezone)} {session.title}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </TabsContent>
          <TabsContent value="track">
            <GroupedView
              event={event}
              sessions={filteredSessions}
              groups={tracks}
              onSelectSession={onSelectSession}
              groupBy="track"
            />
          </TabsContent>
          <TabsContent value="room">
            <GroupedView
              event={event}
              sessions={filteredSessions}
              groups={rooms}
              onSelectSession={onSelectSession}
              groupBy="room"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
