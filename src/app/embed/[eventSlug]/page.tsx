import type { ReactNode } from "react";

import { CalendarDays, Filter, LayoutList, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EMBED_FILTER_LABELS,
  EMBED_KIND_LABELS,
  type EmbedKind,
  parseEmbedSearchParams,
  serializeEmbedConfiguration,
} from "@/lib/published-embeds/configuration";
import { cn } from "@/lib/utils";
import { getDatabaseClient } from "@/server/database/client";
import { PublishedProgramRepository } from "@/server/published-program";

import { EmbedFrameBridge } from "../_components/embed-frame-bridge";
import { PublishedSpeakerList, type PublishedSpeakerListItem } from "./_components/published-speaker-list";

const KIND_ICONS = {
  agenda: CalendarDays,
  "session-list": LayoutList,
  itinerary: CalendarDays,
  "speaker-list": Users,
  "speaker-gallery": Users,
} satisfies Record<EmbedKind, typeof CalendarDays>;

function toUrlSearchParams(values: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

function speakerName(speaker: {
  readonly preferredName: string | null;
  readonly givenName: string;
  readonly familyName: string;
}): string {
  return `${speaker.preferredName ?? speaker.givenName} ${speaker.familyName}`;
}

function speakerInitials(speaker: {
  readonly preferredName: string | null;
  readonly givenName: string;
  readonly familyName: string;
}): string {
  return `${(speaker.preferredName ?? speaker.givenName).charAt(0)}${speaker.familyName.charAt(0)}`.toLocaleUpperCase();
}

async function publishedSpeakerList(
  eventSlug: string,
  configuration: ReturnType<typeof parseEmbedSearchParams>,
): Promise<
  | { readonly status: "available"; readonly eventName: string; readonly speakers: readonly PublishedSpeakerListItem[] }
  | { readonly status: "unavailable" }
> {
  const publication = await new PublishedProgramRepository(getDatabaseClient()).findPublic(eventSlug);
  if (publication.status !== "published") return { status: "unavailable" };

  const { snapshot } = publication.version;
  const sessionsBySpeaker = new Map<string, { readonly id: string; readonly title: string; readonly href: string }[]>();
  const query = serializeEmbedConfiguration({
    kind: "session-list",
    theme: configuration.theme,
    density: configuration.density,
    filters: ["search", "track"],
  });
  for (const session of snapshot.sessions) {
    const linkedSession = {
      id: session.id,
      title: session.title,
      href: `/embed/${encodeURIComponent(eventSlug)}?${query}#session-${encodeURIComponent(session.id)}`,
    };
    for (const speakerId of session.speakerIds) {
      const sessions = sessionsBySpeaker.get(speakerId) ?? [];
      sessions.push(linkedSession);
      sessionsBySpeaker.set(speakerId, sessions);
    }
  }

  return {
    status: "available",
    eventName: snapshot.event.name,
    speakers: snapshot.speakers
      .map((speaker) => ({
        id: speaker.id,
        name: speakerName(speaker),
        initials: speakerInitials(speaker),
        pronouns: speaker.pronouns,
        organization: speaker.organization,
        jobTitle: speaker.jobTitle,
        biography: speaker.biography,
        websiteUrl: speaker.websiteUrl,
        sessions: sessionsBySpeaker.get(speaker.id) ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export default async function PublishedEmbedPreview({
  params,
  searchParams,
}: {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ eventSlug }, rawSearchParams] = await Promise.all([params, searchParams]);
  const configuration = parseEmbedSearchParams(toUrlSearchParams(rawSearchParams));
  const instanceValue = rawSearchParams.instance;
  const instance =
    typeof instanceValue === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(instanceValue) ? instanceValue : "preview";
  const Icon = KIND_ICONS[configuration.kind];
  const speakerList =
    configuration.kind === "speaker-list" ? await publishedSpeakerList(eventSlug, configuration) : null;
  let content: ReactNode;
  if (speakerList?.status === "available") {
    content = (
      <PublishedSpeakerList
        density={configuration.density}
        enabledFilters={configuration.filters}
        eventName={speakerList.eventName}
        speakers={speakerList.speakers}
      />
    );
  } else if (configuration.kind === "speaker-list") {
    content = (
      <Card className="mx-auto w-full max-w-4xl" size={configuration.density === "compact" ? "sm" : "default"}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users aria-hidden="true" />
            <CardTitle>
              <h1>Speakers unavailable</h1>
            </CardTitle>
          </div>
          <CardDescription>This event does not currently have a published speaker list.</CardDescription>
        </CardHeader>
      </Card>
    );
  } else {
    content = (
      <Card size={configuration.density === "compact" ? "sm" : "default"}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Icon aria-hidden="true" />
            <CardTitle>
              <h1>{EMBED_KIND_LABELS[configuration.kind]}</h1>
            </CardTitle>
          </div>
          <CardDescription>Published program preview for {eventSlug}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {configuration.filters.length > 0 ? (
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Enabled filters</legend>
              <Filter aria-hidden="true" />
              {configuration.filters.map((filter) => (
                <Badge key={filter} variant="outline">
                  {EMBED_FILTER_LABELS[filter]}
                </Badge>
              ))}
            </fieldset>
          ) : null}
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="font-medium">Your published content will appear here</p>
            <p className="text-muted-foreground text-sm">
              This preview uses the exact configuration URL from the install snippet. Publish the program to populate
              the selected widget.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <main
      className={cn(
        "min-h-64 bg-background p-4 text-foreground",
        configuration.density === "compact" ? "sm:p-4" : "sm:p-6",
        configuration.theme === "dark" && "dark",
        configuration.theme === "light" && "light",
      )}
      data-embed-configuration={JSON.stringify(configuration)}
    >
      <EmbedFrameBridge instance={instance} />
      {content}
    </main>
  );
}
