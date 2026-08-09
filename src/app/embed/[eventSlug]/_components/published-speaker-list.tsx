"use client";

import { useMemo, useState } from "react";

import { ExternalLink, Search, Users } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { EmbedDensity, EmbedFilter } from "@/lib/published-embeds/configuration";

export interface PublishedSpeakerListItem {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly pronouns: string | null;
  readonly organization: string | null;
  readonly jobTitle: string | null;
  readonly biography: string | null;
  readonly websiteUrl: string | null;
  readonly sessions: readonly { readonly id: string; readonly title: string; readonly href: string }[];
}

interface PublishedSpeakerListProps {
  readonly density: EmbedDensity;
  readonly enabledFilters: readonly EmbedFilter[];
  readonly eventName: string;
  readonly speakers: readonly PublishedSpeakerListItem[];
}

function matchesSearch(speaker: PublishedSpeakerListItem, search: string): boolean {
  if (search === "") return true;
  const text = [
    speaker.name,
    speaker.pronouns,
    speaker.organization,
    speaker.jobTitle,
    speaker.biography,
    ...speaker.sessions.map(({ title }) => title),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return text.includes(search.toLocaleLowerCase());
}

export function PublishedSpeakerList({ density, enabledFilters, eventName, speakers }: PublishedSpeakerListProps) {
  const [search, setSearch] = useState("");
  const [organization, setOrganization] = useState("");
  const showSearch = enabledFilters.includes("search");
  const showOrganization = enabledFilters.includes("organization");
  const organizations = useMemo(
    () =>
      [...new Set(speakers.flatMap((speaker) => (speaker.organization ? [speaker.organization] : [])))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [speakers],
  );
  const visibleSpeakers = speakers.filter(
    (speaker) =>
      matchesSearch(speaker, showSearch ? search.trim() : "") &&
      (!organization || speaker.organization === organization),
  );

  return (
    <section aria-labelledby="speaker-list-title" className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{eventName}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight" id="speaker-list-title">
          Speakers
        </h1>
        <p className="text-muted-foreground text-sm">
          Meet the speakers and explore their sessions in the published program.
        </p>
      </header>

      {showSearch || showOrganization ? (
        <FieldGroup className="rounded-xl border bg-card p-3 sm:flex-row sm:items-end">
          {showSearch ? (
            <Field>
              <FieldLabel htmlFor="speaker-search">Search speakers</FieldLabel>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  className="pl-8"
                  id="speaker-search"
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Name, organization, or session"
                  type="search"
                  value={search}
                />
              </div>
            </Field>
          ) : null}
          {showOrganization ? (
            <Field className="sm:max-w-64">
              <FieldLabel htmlFor="speaker-organization">Organization</FieldLabel>
              <NativeSelect
                className="w-full"
                id="speaker-organization"
                onChange={(event) => setOrganization(event.currentTarget.value)}
                value={organization}
              >
                <NativeSelectOption value="">All organizations</NativeSelectOption>
                {organizations.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {option}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </FieldGroup>
      ) : null}

      {visibleSpeakers.length > 0 ? (
        <ul aria-live="polite" className="flex flex-col gap-3">
          {visibleSpeakers.map((speaker) => (
            <li key={speaker.id}>
              <Card size={density === "compact" ? "sm" : "default"}>
                <CardHeader className="grid grid-cols-[auto_1fr] gap-x-3">
                  <Avatar aria-label={`${speaker.name} profile image`} className="row-span-2" size="lg">
                    <AvatarFallback>{speaker.initials}</AvatarFallback>
                  </Avatar>
                  <CardTitle className="min-w-0 break-words">{speaker.name}</CardTitle>
                  <CardDescription className="min-w-0 break-words">
                    {[speaker.jobTitle, speaker.organization].filter(Boolean).join(" at ") || "Event speaker"}
                    {speaker.pronouns ? ` · ${speaker.pronouns}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {speaker.biography ? (
                    <p className="break-words text-sm leading-relaxed">{speaker.biography}</p>
                  ) : null}
                  {speaker.websiteUrl ? (
                    <a
                      className="inline-flex w-fit items-center gap-1 font-medium text-primary text-sm underline-offset-4 hover:underline"
                      href={speaker.websiteUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Speaker website
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      Published sessions
                    </h2>
                    {speaker.sessions.length > 0 ? (
                      <ul className="flex flex-wrap gap-2">
                        {speaker.sessions.map((session) => (
                          <li key={session.id}>
                            <Badge asChild variant="outline">
                              <a href={session.href}>{session.title}</a>
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-sm">No linked sessions are currently published.</p>
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
              <Users aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{speakers.length === 0 ? "No published speakers" : "No matching speakers"}</EmptyTitle>
            <EmptyDescription>
              {speakers.length === 0
                ? "Speaker profiles will appear here when they are included in a published program."
                : "Try a different search or organization."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
}
