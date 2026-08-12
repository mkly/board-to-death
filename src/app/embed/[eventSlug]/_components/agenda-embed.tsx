"use client";

import { useMemo, useState } from "react";

import { CalendarDays, MapPin, Monitor, Moon, Search, Sun } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { EmbedConfiguration, EmbedTheme } from "@/lib/published-embeds/configuration";
import { cn } from "@/lib/utils";

import { EmbedFrameBridge } from "../../_components/embed-frame-bridge";
import { EmbedHeader, TrackChip, TrackDot, zoneAbbreviation } from "./embed-kit";

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
  readonly tracks: readonly { readonly id: string; readonly name: string; readonly color?: string | null }[];
  readonly speakers: readonly { readonly id: string; readonly name: string }[];
}

interface AgendaEmbedData {
  readonly event: {
    readonly name: string;
    readonly timezone: string;
    readonly location: string | null;
  } | null;
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly tracks: readonly { readonly id: string; readonly name: string; readonly color?: string | null }[];
  readonly placements: readonly AgendaEmbedPlacement[];
}

interface AgendaEmbedProps {
  readonly configuration: EmbedConfiguration;
  readonly data: AgendaEmbedData;
  readonly instance: string;
  readonly publishedAt: string;
}

const THEME_OPTIONS: readonly { readonly value: EmbedTheme; readonly label: string; readonly Icon: typeof Sun }[] = [
  { value: "system", label: "System theme", Icon: Monitor },
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
];

function dayKey(value: string, timezone: string): string {
  return Temporal.Instant.from(value).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

function dayLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(new Date(value));
}

function dayOptionLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: timezone }).format(new Date(value));
}

function timeLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(
    new Date(value),
  );
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
  const compact = configuration.density === "compact";
  const timezone = event?.timezone ?? "America/Los_Angeles";
  const zoneLabel = zoneAbbreviation(placements[0]?.startsAt ?? publishedAt, timezone);
  const days = useMemo(
    () => [...new Set(placements.map((placement) => dayKey(placement.startsAt, timezone)))],
    [timezone, placements],
  );
  const visiblePlacements = useMemo(() => {
    const filtered = placements.filter(
      (placement) =>
        (!enabledFilters.has("search") || search === "" || matchesSearch(placement, search)) &&
        (!enabledFilters.has("room") || roomId === "all" || placement.room.id === roomId) &&
        (!enabledFilters.has("track") || trackId === "all" || placement.tracks.some((track) => track.id === trackId)) &&
        (!enabledFilters.has("day") || day === "all" || dayKey(placement.startsAt, timezone) === day),
    );
    const bySessionId = new Map(filtered.map((placement) => [placement.sessionId, placement]));
    return filtered.toSorted((left, right) => {
      const leftRoot =
        left.parentSessionId && bySessionId.has(left.parentSessionId) ? left.parentSessionId : left.sessionId;
      const rightRoot =
        right.parentSessionId && bySessionId.has(right.parentSessionId) ? right.parentSessionId : right.sessionId;
      const rootTime = (bySessionId.get(leftRoot)?.startsAt ?? left.startsAt).localeCompare(
        bySessionId.get(rightRoot)?.startsAt ?? right.startsAt,
      );
      if (rootTime !== 0) return rootTime;
      if (left.parentSessionId === null) return -1;
      if (right.parentSessionId === null) return 1;
      return left.startsAt.localeCompare(right.startsAt);
    });
  }, [day, enabledFilters, timezone, placements, roomId, search, trackId]);
  const groupedPlacements = useMemo(
    () =>
      visiblePlacements.reduce<Map<string, AgendaEmbedPlacement[]>>((groups, placement) => {
        const key = dayKey(placement.startsAt, timezone);
        const entries = groups.get(key) ?? [];
        entries.push(placement);
        groups.set(key, entries);
        return groups;
      }, new Map()),
    [timezone, visiblePlacements],
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
        compact ? "p-3 sm:p-4" : "p-4 sm:p-6",
        theme === "dark" && "dark",
        theme === "light" && "light",
      )}
      data-embed-configuration={JSON.stringify(configuration)}
      data-embed-theme={theme}
    >
      <EmbedFrameBridge instance={instance} />
      <div className={cn("mx-auto flex max-w-3xl flex-col", compact ? "gap-4" : "gap-6")}>
        <EmbedHeader
          eyebrow="Agenda"
          title={event?.name ?? "Event agenda"}
          description={
            <>
              {event?.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden="true" className="size-3.5" />
                  {event.location}
                </span>
              ) : null}
              <span>Times in {zoneLabel}</span>
            </>
          }
        >
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
            {THEME_OPTIONS.map(({ value, label, Icon }) => (
              <ToggleGroupItem key={value} value={value} aria-label={label} title={label}>
                <Icon aria-hidden="true" className="size-4" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </EmbedHeader>

        {configuration.filters.length > 0 ? (
          <search>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-y py-3">
              {enabledFilters.has("search") ? (
                <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                  <label
                    className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
                    htmlFor="agenda-search"
                  >
                    Search
                  </label>
                  <div className="relative">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      id="agenda-search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Title, speaker, room…"
                      className="pl-8"
                    />
                  </div>
                </div>
              ) : null}
              {enabledFilters.has("day") ? (
                <div className="flex flex-col gap-1.5">
                  <label
                    className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
                    htmlFor="agenda-day"
                  >
                    Day
                  </label>
                  <Select value={day} onValueChange={setDay}>
                    <SelectTrigger id="agenda-day" className="min-w-32">
                      <SelectValue placeholder="All days" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        <SelectItem value="all">All days</SelectItem>
                        {days.map((value) => {
                          const placement = placements.find(
                            (candidate) => dayKey(candidate.startsAt, timezone) === value,
                          );
                          return placement ? (
                            <SelectItem key={value} value={value}>
                              {dayOptionLabel(placement.startsAt, timezone)}
                            </SelectItem>
                          ) : null;
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {enabledFilters.has("room") ? (
                <div className="flex flex-col gap-1.5">
                  <label
                    className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
                    htmlFor="agenda-room"
                  >
                    Room
                  </label>
                  <Select value={roomId} onValueChange={setRoomId}>
                    <SelectTrigger id="agenda-room" className="min-w-32">
                      <SelectValue placeholder="All rooms" />
                    </SelectTrigger>
                    <SelectContent position="popper">
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
                </div>
              ) : null}
              {enabledFilters.has("track") ? (
                <div className="flex flex-col gap-1.5">
                  <label
                    className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
                    htmlFor="agenda-track"
                  >
                    Track
                  </label>
                  <Select value={trackId} onValueChange={setTrackId}>
                    <SelectTrigger id="agenda-track" className="min-w-36">
                      <SelectValue placeholder="All tracks" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        <SelectItem value="all">All tracks</SelectItem>
                        {tracks.map((track) => (
                          <SelectItem key={track.id} value={track.id}>
                            <TrackDot color={track.color} />
                            {track.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          </search>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {visiblePlacements.length} {visiblePlacements.length === 1 ? "session" : "sessions"} shown.
        </p>

        {placements.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDays />
              </EmptyMedia>
              <EmptyTitle>No published sessions</EmptyTitle>
              <EmptyDescription>The organizer has not added any sessions to this agenda.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {placements.length > 0 && visiblePlacements.length === 0 ? (
          <Empty className="border border-dashed">
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
        ) : null}

        {visiblePlacements.length > 0 ? (
          <div className={cn("flex flex-col", compact ? "gap-5" : "gap-8")}>
            {[...groupedPlacements.entries()].map(([key, entries]) => (
              <section key={key} className="flex flex-col" aria-labelledby={`agenda-day-${key}`}>
                <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                  <h2 id={`agenda-day-${key}`} className="font-bold font-heading text-lg tracking-tight">
                    {dayLabel(entries[0]?.startsAt ?? key, timezone)}
                  </h2>
                  <p className="font-mono text-muted-foreground text-xs tabular-nums">
                    {entries.length} {entries.length === 1 ? "session" : "sessions"}
                  </p>
                </div>
                <ol className="list-none">
                  {entries.map((placement, index) => {
                    const previous = entries[index - 1];
                    const showTime = !previous || previous.startsAt !== placement.startsAt;
                    const isSubsession = placement.parentSessionId !== null;
                    return (
                      <li
                        key={placement.id}
                        id={`session-${placement.sessionId}`}
                        data-parent-session={placement.parentSessionId ?? undefined}
                        className="group grid scroll-mt-4 grid-cols-[3.25rem_0.75rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[4.25rem_0.75rem_minmax(0,1fr)] sm:gap-x-4"
                      >
                        <div className={cn("text-right", compact ? "pt-3.5" : "pt-4.5")}>
                          {showTime ? (
                            <>
                              <time
                                className="block font-mono font-semibold text-foreground text-sm tabular-nums leading-tight"
                                dateTime={placement.startsAt}
                              >
                                {timeLabel(placement.startsAt, timezone)}
                              </time>
                              <time
                                className="block font-mono text-muted-foreground text-xs tabular-nums"
                                dateTime={placement.endsAt}
                              >
                                {timeLabel(placement.endsAt, timezone)}
                              </time>
                            </>
                          ) : null}
                        </div>
                        <div aria-hidden="true" className="relative flex justify-center">
                          <span className="absolute inset-y-0 w-px bg-border group-last:h-6" />
                          <TrackDot
                            color={placement.tracks[0]?.color}
                            className={cn(
                              "relative ring-4 ring-background",
                              compact ? "mt-4" : "mt-5",
                              isSubsession ? "size-1.5" : "size-2.5",
                            )}
                          />
                        </div>
                        <div className={cn("flex flex-col gap-1.5", compact ? "py-3" : "py-4")}>
                          {isSubsession && placement.parentSessionTitle ? (
                            <p className="text-muted-foreground text-xs">Part of {placement.parentSessionTitle}</p>
                          ) : null}
                          <h3
                            className={cn(
                              "font-heading font-semibold leading-snug",
                              isSubsession ? "text-sm" : "text-base",
                            )}
                          >
                            <a
                              href={`#session-${placement.sessionId}`}
                              className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {placement.title}
                            </a>
                          </h3>
                          <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-sm">
                            <span className="inline-flex items-center gap-1">
                              <MapPin aria-hidden="true" className="size-3.5" />
                              {placement.room.name}
                            </span>
                            {placement.speakers.length > 0 ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{placement.speakers.map(({ name }) => name).join(", ")}</span>
                              </>
                            ) : null}
                          </p>
                          {placement.description ? (
                            <p className="text-muted-foreground text-sm leading-relaxed">{placement.description}</p>
                          ) : null}
                          {placement.tracks.length > 0 ? (
                            <p className="mt-0.5 flex flex-wrap gap-1.5">
                              {placement.tracks.map((track) => (
                                <TrackChip key={track.id} name={track.name} color={track.color} />
                              ))}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        ) : null}

        <footer className="border-t pt-3 text-muted-foreground text-xs">
          Published{" "}
          <time dateTime={publishedAt}>
            {new Intl.DateTimeFormat("en", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: timezone,
            }).format(new Date(publishedAt))}
          </time>
        </footer>
      </div>
    </main>
  );
}
