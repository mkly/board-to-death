"use client";

import { useMemo, useState } from "react";

import { CalendarDays, Clock3, MapPin, Search, Tags, Users } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { EmbedConfiguration, EmbedTheme } from "@/lib/published-embeds/configuration";
import { cn } from "@/lib/utils";

import { EmbedFrameBridge } from "../../_components/embed-frame-bridge";

interface AgendaEmbedPlacement {
  readonly id: string;
  readonly sessionId: string;
  readonly title: string;
  readonly description: string | null;
  readonly parentSessionId: string | null;
  readonly parentSessionTitle: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly room: { readonly id: string; readonly name: string };
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
  readonly speakers: readonly { readonly id: string; readonly name: string }[];
}

interface AgendaEmbedData {
  readonly event: {
    readonly name: string;
    readonly timezone: string;
    readonly location: string | null;
  };
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
  readonly placements: readonly AgendaEmbedPlacement[];
}

interface AgendaEmbedProps {
  readonly configuration: EmbedConfiguration;
  readonly data: AgendaEmbedData;
  readonly instance: string;
  readonly publishedAt: string;
}

const THEME_LABELS: Readonly<Record<EmbedTheme, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function dayKey(value: string, timezone: string): string {
  return Temporal.Instant.from(value).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

function dateLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: timezone }).format(new Date(value));
}

function timeLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", { timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function matchesSearch(placement: AgendaEmbedPlacement, query: string): boolean {
  const searchable = [
    placement.title,
    placement.description ?? "",
    placement.room.name,
    ...placement.tracks.map(({ name }) => name),
    ...placement.speakers.map(({ name }) => name),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return searchable.includes(query.toLocaleLowerCase());
}

export function AgendaEmbed({ configuration, data, instance, publishedAt }: AgendaEmbedProps) {
  const { event, placements, rooms, tracks } = data;
  const [theme, setTheme] = useState<EmbedTheme>(configuration.theme);
  const [search, setSearch] = useState("");
  const [roomId, setRoomId] = useState("all");
  const [trackId, setTrackId] = useState("all");
  const [day, setDay] = useState("all");
  const enabledFilters = useMemo(() => new Set(configuration.filters), [configuration.filters]);
  const days = useMemo(
    () => [...new Set(placements.map((placement) => dayKey(placement.startsAt, event.timezone)))],
    [event.timezone, placements],
  );
  const visiblePlacements = useMemo(
    () => {
      const filtered = placements.filter(
        (placement) =>
          (!enabledFilters.has("search") || search === "" || matchesSearch(placement, search)) &&
          (!enabledFilters.has("room") || roomId === "all" || placement.room.id === roomId) &&
          (!enabledFilters.has("track") ||
            trackId === "all" ||
            placement.tracks.some((track) => track.id === trackId)) &&
          (!enabledFilters.has("day") || day === "all" || dayKey(placement.startsAt, event.timezone) === day),
      );
      const bySessionId = new Map(filtered.map((placement) => [placement.sessionId, placement]));
      return filtered.toSorted((left, right) => {
        const leftRoot = left.parentSessionId && bySessionId.has(left.parentSessionId) ? left.parentSessionId : left.sessionId;
        const rightRoot =
          right.parentSessionId && bySessionId.has(right.parentSessionId) ? right.parentSessionId : right.sessionId;
        const rootTime =
          (bySessionId.get(leftRoot)?.startsAt ?? left.startsAt).localeCompare(
            bySessionId.get(rightRoot)?.startsAt ?? right.startsAt,
          );
        if (rootTime !== 0) return rootTime;
        if (left.parentSessionId === null) return -1;
        if (right.parentSessionId === null) return 1;
        return left.startsAt.localeCompare(right.startsAt);
      });
    },
    [day, enabledFilters, event.timezone, placements, roomId, search, trackId],
  );
  const groupedPlacements = useMemo(
    () =>
      visiblePlacements.reduce<Map<string, AgendaEmbedPlacement[]>>((groups, placement) => {
        const key = dayKey(placement.startsAt, event.timezone);
        const entries = groups.get(key) ?? [];
        entries.push(placement);
        groups.set(key, entries);
        return groups;
      }, new Map()),
    [event.timezone, visiblePlacements],
  );
  const clearFilters = () => {
    setSearch("");
    setRoomId("all");
    setTrackId("all");
    setDay("all");
  };

  return (
    <main
      className={cn(
        "min-h-64 bg-background text-foreground",
        configuration.density === "compact" ? "p-3 sm:p-4" : "p-4 sm:p-6",
        theme === "dark" && "dark",
        theme === "light" && "light",
      )}
      data-embed-configuration={JSON.stringify(configuration)}
      data-embed-theme={theme}
    >
      <EmbedFrameBridge instance={instance} />
      <div className={cn("mx-auto flex max-w-5xl flex-col", configuration.density === "compact" ? "gap-3" : "gap-5")}>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-muted-foreground text-sm">Published agenda</p>
            <h1 className="font-heading font-semibold text-2xl tracking-tight">{event.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm">
              <span>{event.timezone}</span>
              {event.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden="true" />
                  {event.location}
                </span>
              ) : null}
            </div>
          </div>
          <Field className="w-auto shrink-0">
            <FieldLabel className="sr-only">Color theme</FieldLabel>
            <ToggleGroup
              type="single"
              value={theme}
              onValueChange={(value) => {
                if (value) setTheme(value as EmbedTheme);
              }}
              variant="outline"
              size="sm"
              aria-label="Color theme"
            >
              {(Object.keys(THEME_LABELS) as EmbedTheme[]).map((value) => (
                <ToggleGroupItem key={value} value={value} aria-label={`${THEME_LABELS[value]} theme`}>
                  {THEME_LABELS[value]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </header>

        {configuration.filters.length > 0 ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Find a session</CardTitle>
              <CardDescription>Filter times shown in {event.timezone}.</CardDescription>
            </CardHeader>
            <CardContent>
              <search>
                <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {enabledFilters.has("search") ? (
                    <Field className={cn(configuration.filters.length > 1 && "sm:col-span-2 lg:col-span-1")}>
                      <FieldLabel htmlFor="agenda-search">Search</FieldLabel>
                      <div className="relative">
                        <Search
                          aria-hidden="true"
                          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          id="agenda-search"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Title, speaker, room…"
                          className="pl-8"
                        />
                      </div>
                    </Field>
                  ) : null}
                  {enabledFilters.has("day") ? (
                    <Field>
                      <FieldLabel htmlFor="agenda-day">Day</FieldLabel>
                      <Select value={day} onValueChange={setDay}>
                        <SelectTrigger id="agenda-day" className="w-full">
                          <SelectValue placeholder="All days" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="all">All days</SelectItem>
                            {days.map((value) => {
                              const placement = placements.find(
                                (candidate) => dayKey(candidate.startsAt, event.timezone) === value,
                              );
                              return placement ? (
                                <SelectItem key={value} value={value}>
                                  {dateLabel(placement.startsAt, event.timezone)}
                                </SelectItem>
                              ) : null;
                            })}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : null}
                  {enabledFilters.has("room") ? (
                    <Field>
                      <FieldLabel htmlFor="agenda-room">Room</FieldLabel>
                      <Select value={roomId} onValueChange={setRoomId}>
                        <SelectTrigger id="agenda-room" className="w-full">
                          <SelectValue placeholder="All rooms" />
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
                  ) : null}
                  {enabledFilters.has("track") ? (
                    <Field>
                      <FieldLabel htmlFor="agenda-track">Track</FieldLabel>
                      <Select value={trackId} onValueChange={setTrackId}>
                        <SelectTrigger id="agenda-track" className="w-full">
                          <SelectValue placeholder="All tracks" />
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
                  ) : null}
                </FieldGroup>
              </search>
            </CardContent>
          </Card>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {visiblePlacements.length} {visiblePlacements.length === 1 ? "session" : "sessions"} shown.
        </p>

        {placements.length === 0 ? (
          <Card>
            <CardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CalendarDays />
                  </EmptyMedia>
                  <EmptyTitle>No published sessions</EmptyTitle>
                  <EmptyDescription>The organizer has not added any sessions to this agenda.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        ) : null}

        {placements.length > 0 && visiblePlacements.length === 0 ? (
          <Card>
            <CardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Search />
                  </EmptyMedia>
                  <EmptyTitle>No sessions match</EmptyTitle>
                  <EmptyDescription>Try another search, day, room, or track.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button type="button" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            </CardContent>
          </Card>
        ) : null}

        {visiblePlacements.length > 0 ? (
          <div className={cn("flex flex-col", configuration.density === "compact" ? "gap-4" : "gap-6")}>
            {[...groupedPlacements.entries()].map(([key, entries]) => (
              <section key={key} className="flex flex-col gap-3" aria-labelledby={`agenda-day-${key}`}>
                <div className="flex items-center gap-2">
                  <CalendarDays aria-hidden="true" />
                  <h2 id={`agenda-day-${key}`} className="font-heading font-medium text-lg">
                    {dateLabel(entries[0]?.startsAt ?? key, event.timezone)}
                  </h2>
                </div>
                <ol className="grid list-none gap-3 md:grid-cols-2">
                  {entries.map((placement) => (
                    <li key={placement.id}>
                      <Card
                        id={`session-${placement.sessionId}`}
                        size={configuration.density === "compact" ? "sm" : "default"}
                        className={cn("h-full scroll-mt-4", placement.parentSessionId && "ml-4")}
                        data-parent-session={placement.parentSessionId ?? undefined}
                      >
                        <CardHeader>
                          <CardTitle>
                            <a href={`#session-${placement.sessionId}`} className="underline-offset-4 hover:underline">
                              {placement.title}
                            </a>
                          </CardTitle>
                          {placement.parentSessionTitle ? (
                            <Badge variant="outline" className="w-fit">
                              Subsession of {placement.parentSessionTitle}
                            </Badge>
                          ) : null}
                          <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1">
                              <Clock3 aria-hidden="true" />
                              <time dateTime={placement.startsAt}>{timeLabel(placement.startsAt, event.timezone)}</time>
                              <span aria-hidden="true">–</span>
                              <time dateTime={placement.endsAt}>{timeLabel(placement.endsAt, event.timezone)}</time>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin aria-hidden="true" />
                              {placement.room.name}
                            </span>
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                          {placement.description ? <p>{placement.description}</p> : null}
                          {placement.speakers.length > 0 ? (
                            <div className="flex items-start gap-2 text-muted-foreground text-sm">
                              <Users aria-hidden="true" />
                              <span>{placement.speakers.map(({ name }) => name).join(", ")}</span>
                            </div>
                          ) : null}
                          {placement.tracks.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Tags aria-hidden="true" />
                              {placement.tracks.map((track) => (
                                <Badge key={track.id} variant="outline">
                                  {track.name}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : null}

        <footer className="text-muted-foreground text-xs">
          Published{" "}
          <time dateTime={publishedAt}>
            {new Intl.DateTimeFormat("en", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: event.timezone,
            }).format(new Date(publishedAt))}
          </time>
        </footer>
      </div>
    </main>
  );
}
