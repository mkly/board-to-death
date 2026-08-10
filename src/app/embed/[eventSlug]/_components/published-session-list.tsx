"use client";

import { useMemo, useState } from "react";

import { Clock3, LayoutList, MapPin, Search } from "lucide-react";

import { FormSelect } from "@/components/form-select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { EmbedDensity, EmbedFilter } from "@/lib/published-embeds/configuration";

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
  readonly track: { readonly id: string; readonly name: string } | null;
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

export function PublishedSessionList({ density, enabledFilters, eventName, sessions }: PublishedSessionListProps) {
  const [search, setSearch] = useState("");
  const [trackId, setTrackId] = useState("");
  const [format, setFormat] = useState("");
  const [locationId, setLocationId] = useState("");
  const showSearch = enabledFilters.includes("search");
  const showTrack = enabledFilters.includes("track");
  const showFormat = enabledFilters.includes("format");
  const showLocation = enabledFilters.includes("room");
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
    <section aria-labelledby="session-list-title" className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{eventName}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight" id="session-list-title">
          Sessions
        </h1>
        <p className="text-muted-foreground text-sm">Explore the sessions and speakers in the published program.</p>
      </header>

      {showSearch || showTrack || showFormat || showLocation ? (
        <FieldGroup className="rounded-xl border bg-card p-3 sm:grid sm:grid-cols-2 sm:items-end lg:grid-cols-4">
          {showSearch ? (
            <Field>
              <FieldLabel htmlFor="session-search">Search sessions</FieldLabel>
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
            </Field>
          ) : null}
          {showTrack ? (
            <Field className="sm:max-w-64">
              <FieldLabel htmlFor="session-track">Track</FieldLabel>
              <FormSelect
                className="w-full"
                id="session-track"
                onValueChange={setTrackId}
                value={trackId}
                options={[
                  { value: "", label: "All tracks" },
                  ...tracks.map((track) => ({ value: track.id, label: track.name })),
                ]}
              />
            </Field>
          ) : null}
          {showFormat ? (
            <Field>
              <FieldLabel htmlFor="session-format">Format</FieldLabel>
              <FormSelect
                className="w-full"
                id="session-format"
                onValueChange={setFormat}
                value={format}
                options={[{ value: "", label: "All formats" }, ...formats.map((value) => ({ value, label: value }))]}
              />
            </Field>
          ) : null}
          {showLocation ? (
            <Field>
              <FieldLabel htmlFor="session-location">Location</FieldLabel>
              <FormSelect
                className="w-full"
                id="session-location"
                onValueChange={setLocationId}
                value={locationId}
                options={[
                  { value: "", label: "All locations" },
                  ...locations.map((location) => ({ value: location.id, label: location.name })),
                ]}
              />
            </Field>
          ) : null}
        </FieldGroup>
      ) : null}

      <p aria-live="polite" className="sr-only" role="status">
        {visibleSessions.length === 1 ? "1 session shown" : `${visibleSessions.length} sessions shown`}
      </p>

      {visibleSessions.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {visibleSessions.map((session) => (
            <li id={`session-${session.id}`} key={session.id}>
              <Card size={density === "compact" ? "sm" : "default"}>
                <CardHeader>
                  <CardTitle className="min-w-0 break-words">
                    <h2>
                      <a
                        className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        href={`#session-${session.id}`}
                      >
                        {session.title}
                      </a>
                    </h2>
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1">
                      <Clock3 aria-hidden="true" className="size-3.5" />
                      {session.durationMinutes} minutes
                    </span>
                    {session.track ? <Badge variant="outline">{session.track.name}</Badge> : null}
                    {session.format ? <Badge variant="secondary">{session.format}</Badge> : null}
                    {session.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin aria-hidden="true" className="size-3.5" />
                        {session.location.name}
                      </span>
                    ) : null}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {session.description ? (
                    <p className="break-words text-sm leading-relaxed">{session.description}</p>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Speakers</h3>
                    {session.speakers.length > 0 ? (
                      <ul className="flex flex-wrap gap-2">
                        {session.speakers.map((speaker) => (
                          <li key={speaker.id}>
                            <Badge variant="secondary">{speaker.name}</Badge>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-sm">No public speaker profiles are linked.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Empty className="border">
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
