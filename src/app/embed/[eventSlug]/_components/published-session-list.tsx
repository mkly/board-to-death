"use client";

import { useMemo, useState } from "react";

import { LayoutList, MapPin, Search } from "lucide-react";

import { FormSelect } from "@/components/form-select";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { EmbedDensity, EmbedFilter } from "@/lib/published-embeds/configuration";
import { cn } from "@/lib/utils";

import { EmbedHeader, TrackChip } from "./embed-kit";

interface PublishedSessionSpeaker {
  readonly id: string;
  readonly name: string;
}

export interface PublishedSessionListItem {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly format: string | null;
  readonly location: { readonly id: string; readonly name: string } | null;
  readonly track: { readonly id: string; readonly name: string; readonly color?: string | null } | null;
  readonly speakers: readonly PublishedSessionSpeaker[];
}

interface PublishedSessionListProps {
  readonly density: EmbedDensity;
  readonly enabledFilters: readonly EmbedFilter[];
  readonly eventName: string;
  readonly sessions: readonly PublishedSessionListItem[];
}

function matchesSearch(session: PublishedSessionListItem, search: string): boolean {
  if (search === "") return true;
  const text = [
    session.title,
    session.description,
    session.track?.name,
    session.format,
    session.location?.name,
    ...session.speakers.map(({ name }) => name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return text.includes(search.toLocaleLowerCase());
}

const FILTER_LABEL_CLASS = "font-medium text-[11px] text-muted-foreground uppercase tracking-wide";

export function PublishedSessionList({ density, enabledFilters, eventName, sessions }: PublishedSessionListProps) {
  const [search, setSearch] = useState("");
  const [trackId, setTrackId] = useState("");
  const [format, setFormat] = useState("");
  const [locationId, setLocationId] = useState("");
  const showSearch = enabledFilters.includes("search");
  const showTrack = enabledFilters.includes("track");
  const showFormat = enabledFilters.includes("format");
  const showLocation = enabledFilters.includes("room");
  const compact = density === "compact";
  const tracks = useMemo(
    () =>
      [
        ...new Map(
          sessions.flatMap((session) => (session.track ? [[session.track.id, session.track] as const] : [])),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    [sessions],
  );
  const formats = useMemo(
    () =>
      [...new Set(sessions.flatMap((session) => (session.format ? [session.format] : [])))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [sessions],
  );
  const locations = useMemo(
    () =>
      [
        ...new Map(
          sessions.flatMap((session) => (session.location ? [[session.location.id, session.location] as const] : [])),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    [sessions],
  );
  const visibleSessions = sessions.filter(
    (session) =>
      matchesSearch(session, showSearch ? search.trim() : "") &&
      (!showTrack || !trackId || session.track?.id === trackId) &&
      (!showFormat || !format || session.format === format) &&
      (!showLocation || !locationId || session.location?.id === locationId),
  );

  return (
    <section aria-labelledby="session-list-title" className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <EmbedHeader
        eyebrow="Sessions"
        title={eventName}
        titleId="session-list-title"
        description="Every session in the published program."
      />

      {showSearch || showTrack || showFormat || showLocation ? (
        <div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-y py-3">
            {showSearch ? (
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <label className={FILTER_LABEL_CLASS} htmlFor="session-search">
                  Search sessions
                </label>
                <InputGroup>
                  <InputGroupInput
                    id="session-search"
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    placeholder="Title, speaker, track, format, or location"
                    type="search"
                    value={search}
                  />
                  <InputGroupAddon align="inline-start">
                    <Search aria-hidden="true" />
                  </InputGroupAddon>
                </InputGroup>
              </div>
            ) : null}
            {showTrack ? (
              <div className="flex flex-col gap-1.5">
                <label className={FILTER_LABEL_CLASS} htmlFor="session-track">
                  Track
                </label>
                <FormSelect
                  className="min-w-36"
                  id="session-track"
                  onValueChange={setTrackId}
                  value={trackId}
                  options={[
                    { value: "", label: "All tracks" },
                    ...tracks.map((track) => ({ value: track.id, label: track.name })),
                  ]}
                />
              </div>
            ) : null}
            {showFormat ? (
              <div className="flex flex-col gap-1.5">
                <label className={FILTER_LABEL_CLASS} htmlFor="session-format">
                  Format
                </label>
                <FormSelect
                  className="min-w-32"
                  id="session-format"
                  onValueChange={setFormat}
                  value={format}
                  options={[{ value: "", label: "All formats" }, ...formats.map((value) => ({ value, label: value }))]}
                />
              </div>
            ) : null}
            {showLocation ? (
              <div className="flex flex-col gap-1.5">
                <label className={FILTER_LABEL_CLASS} htmlFor="session-location">
                  Location
                </label>
                <FormSelect
                  className="min-w-32"
                  id="session-location"
                  onValueChange={setLocationId}
                  value={locationId}
                  options={[
                    { value: "", label: "All locations" },
                    ...locations.map((location) => ({ value: location.id, label: location.name })),
                  ]}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only" role="status">
        {visibleSessions.length === 1 ? "1 session shown" : `${visibleSessions.length} sessions shown`}
      </p>

      {visibleSessions.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border bg-card text-card-foreground">
          {visibleSessions.map((session) => (
            <li
              className={cn(
                "flex scroll-mt-4 flex-col gap-1.5 border-b last:border-b-0",
                compact ? "p-3.5" : "p-4 sm:p-5",
              )}
              id={`session-${session.id}`}
              key={session.id}
            >
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-muted-foreground text-xs tabular-nums">
                <span className="font-semibold text-foreground">{session.durationMinutes} min</span>
                {session.format ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{session.format}</span>
                  </>
                ) : null}
                {session.location ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-sans">
                      <MapPin aria-hidden="true" className="size-3.5" />
                      {session.location.name}
                    </span>
                  </>
                ) : null}
              </p>
              <h2 className="min-w-0 break-words font-heading font-semibold text-base leading-snug">
                <a
                  className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={`#session-${session.id}`}
                >
                  {session.title}
                </a>
              </h2>
              {session.description ? (
                <p className="break-words text-muted-foreground text-sm leading-relaxed">{session.description}</p>
              ) : null}
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-muted-foreground text-sm">
                {session.track ? <TrackChip color={session.track.color} name={session.track.name} /> : null}
                {session.speakers.length > 0 ? (
                  <span>With {session.speakers.map(({ name }) => name).join(", ")}</span>
                ) : (
                  <span>No public speaker profiles are linked.</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutList aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{sessions.length === 0 ? "No published sessions" : "No matching sessions"}</EmptyTitle>
            <EmptyDescription>
              {sessions.length === 0
                ? "Sessions will appear here when they are included in a published program."
                : "Try a different search or filter."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
}
