"use client";

import { useMemo, useState } from "react";

import { ExternalLink, Search, Users } from "lucide-react";

import { FormSelect } from "@/components/form-select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { EmbedDensity, EmbedFilter } from "@/lib/published-embeds/configuration";

import { EmbedHeader } from "./embed-kit";

const FILTER_LABEL_CLASS = "font-medium text-[11px] text-muted-foreground uppercase tracking-wide";

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
      <EmbedHeader
        eyebrow="Speakers"
        title={eventName}
        titleId="speaker-list-title"
        description="Meet the speakers and explore their sessions in the published program."
      />

      {showSearch || showOrganization ? (
        <search>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-y py-3">
            {showSearch ? (
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <label className={FILTER_LABEL_CLASS} htmlFor="speaker-search">
                  Search speakers
                </label>
                <InputGroup>
                  <InputGroupInput
                    id="speaker-search"
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    placeholder="Name, organization, or session"
                    type="search"
                    value={search}
                  />
                  <InputGroupAddon align="inline-start">
                    <Search aria-hidden="true" />
                  </InputGroupAddon>
                </InputGroup>
              </div>
            ) : null}
            {showOrganization ? (
              <div className="flex flex-col gap-1.5">
                <label className={FILTER_LABEL_CLASS} htmlFor="speaker-organization">
                  Organization
                </label>
                <FormSelect
                  className="min-w-48"
                  id="speaker-organization"
                  onValueChange={setOrganization}
                  value={organization}
                  options={[
                    { value: "", label: "All organizations" },
                    ...organizations.map((option) => ({ value: option, label: option })),
                  ]}
                />
              </div>
            ) : null}
          </div>
        </search>
      ) : null}

      <p aria-live="polite" className="sr-only" role="status">
        {visibleSpeakers.length === 1 ? "1 speaker shown" : `${visibleSpeakers.length} speakers shown`}
      </p>

      {visibleSpeakers.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {visibleSpeakers.map((speaker) => (
            <li key={speaker.id}>
              <Card size={density === "compact" ? "sm" : "default"}>
                <CardHeader className="grid grid-cols-[auto_1fr] gap-x-3">
                  <Avatar aria-label={`${speaker.name} profile image`} className="row-span-2" role="img" size="lg">
                    <AvatarFallback aria-hidden="true">{speaker.initials}</AvatarFallback>
                  </Avatar>
                  <CardTitle className="min-w-0 break-words font-heading">{speaker.name}</CardTitle>
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
        <Empty className="border border-dashed">
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
