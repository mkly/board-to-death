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
import { PublishedProgramRepository, type PublishedProgramSnapshot } from "@/server/published-program";

import { EmbedFrameBridge } from "../_components/embed-frame-bridge";
import { AgendaEmbed } from "./_components/agenda-embed";
import { type ItinerarySession, ItineraryWorkspace } from "./_components/itinerary-workspace";
import { PublishedSessionList, type PublishedSessionListItem } from "./_components/published-session-list";
import { PublishedSpeakerGallery, type PublishedSpeakerGalleryItem } from "./_components/published-speaker-gallery";
import { PublishedSpeakerList } from "./_components/published-speaker-list";

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

async function publishedSpeakerProfiles(
  eventSlug: string,
  configuration: ReturnType<typeof parseEmbedSearchParams>,
): Promise<
  | {
      readonly status: "available";
      readonly eventName: string;
      readonly speakers: readonly PublishedSpeakerGalleryItem[];
    }
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
        photoHref: speaker.photoObjectKey
          ? `/embed/${encodeURIComponent(eventSlug)}/speakers/${encodeURIComponent(speaker.id)}/photo?v=${publication.version.versionNumber}`
          : null,
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

async function publishedSessionList(
  eventSlug: string,
): Promise<
  | { readonly status: "available"; readonly eventName: string; readonly sessions: readonly PublishedSessionListItem[] }
  | { readonly status: "unavailable" }
> {
  const publication = await new PublishedProgramRepository(getDatabaseClient()).findPublic(eventSlug);
  if (publication.status !== "published") return { status: "unavailable" };

  const { snapshot } = publication.version;
  const tracksById = new Map(snapshot.tracks.map((track) => [track.id, track]));
  const speakersById = new Map(snapshot.speakers.map((speaker) => [speaker.id, speaker]));

  return {
    status: "available",
    eventName: snapshot.event.name,
    sessions: snapshot.sessions
      .map((session) => {
        const track = session.trackId ? tracksById.get(session.trackId) : undefined;
        return {
          id: session.id,
          title: session.title,
          description: session.description,
          durationMinutes: session.durationMinutes,
          track: track ? { id: track.id, name: track.name } : null,
          speakers: session.speakerIds.flatMap((speakerId) => {
            const speaker = speakersById.get(speakerId);
            return speaker ? [{ id: speaker.id, name: speakerName(speaker) }] : [];
          }),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

async function publishedItinerary(eventSlug: string): Promise<
  | {
      readonly status: "available";
      readonly eventId: string;
      readonly eventName: string;
      readonly timezone: string;
      readonly sessions: readonly ItinerarySession[];
    }
  | { readonly status: "unavailable" }
> {
  const publication = await new PublishedProgramRepository(getDatabaseClient()).findPublic(eventSlug);
  if (publication.status !== "published") return { status: "unavailable" };

  const { snapshot } = publication.version;
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const roomsById = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const tracksById = new Map(snapshot.tracks.map((track) => [track.id, track]));
  const speakersById = new Map(snapshot.speakers.map((speaker) => [speaker.id, speaker]));

  return {
    status: "available",
    eventId: snapshot.event.id,
    eventName: snapshot.event.name,
    timezone: snapshot.event.timezone,
    // Placements are the schedulable unit: a session placed twice stays two
    // independently selectable entries, and an unplaced session is not
    // something an attendee can put on a timeline at all.
    sessions: snapshot.placements
      .flatMap((placement) => {
        const session = sessionsById.get(placement.sessionId);
        if (!session) return [];
        return [
          {
            id: placement.id,
            sessionId: session.id,
            title: session.title,
            description: session.description,
            startsAt: placement.startsAt,
            endsAt: placement.endsAt,
            room: roomsById.get(placement.roomId)?.name ?? null,
            tracks: placement.trackIds.flatMap((trackId) => {
              const track = tracksById.get(trackId);
              return track ? [{ id: track.id, name: track.name }] : [];
            }),
            speakers: [...new Set([...session.speakerIds, ...placement.speakerIds])].flatMap((speakerId) => {
              const speaker = speakersById.get(speakerId);
              return speaker ? [speakerName(speaker)] : [];
            }),
          },
        ];
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  };
}

const AGENDA_UNAVAILABLE_COPY = {
  "event-not-found": {
    title: "Event not found",
    description: "Check the embed URL and try again.",
  },
  "not-published": {
    title: "Agenda not published",
    description: "This event does not have a published agenda yet.",
  },
  unpublished: {
    title: "Agenda unavailable",
    description: "The organizer has taken this agenda offline.",
  },
} as const;

function agendaData(snapshot: PublishedProgramSnapshot) {
  const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const rooms = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const tracks = new Map(snapshot.tracks.map((track) => [track.id, track]));
  const speakers = new Map(snapshot.speakers.map((speaker) => [speaker.id, speaker]));

  return {
    event: snapshot.event,
    rooms: snapshot.rooms,
    tracks: snapshot.tracks,
    placements: snapshot.placements.flatMap((placement) => {
      const session = sessions.get(placement.sessionId);
      const room = rooms.get(placement.roomId);
      if (!session || !room) return [];
      return [
        {
          id: placement.id,
          sessionId: session.id,
          title: session.title,
          description: session.description,
          parentSessionId: session.parentSessionId ?? null,
          parentSessionTitle: session.parentSessionId ? (sessions.get(session.parentSessionId)?.title ?? null) : null,
          startsAt: placement.startsAt,
          endsAt: placement.endsAt,
          room: { id: room.id, name: room.name },
          tracks: placement.trackIds.flatMap((trackId) => {
            const track = tracks.get(trackId);
            return track ? [{ id: track.id, name: track.name }] : [];
          }),
          speakers: placement.speakerIds.flatMap((speakerId) => {
            const speaker = speakers.get(speakerId);
            if (!speaker) return [];
            return [
              {
                id: speaker.id,
                name: speaker.preferredName ?? `${speaker.givenName} ${speaker.familyName}`,
              },
            ];
          }),
        },
      ];
    }),
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

  if (configuration.kind === "agenda") {
    const publication = await new PublishedProgramRepository(getDatabaseClient()).findPublic(eventSlug);
    if (publication.status === "published") {
      return (
        <AgendaEmbed
          configuration={configuration}
          data={agendaData(publication.version.snapshot)}
          instance={instance}
          publishedAt={publication.version.createdAt.toISOString()}
        />
      );
    }

    const copy = AGENDA_UNAVAILABLE_COPY[publication.status];
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
        <Card className="mx-auto w-full max-w-4xl" size={configuration.density === "compact" ? "sm" : "default"}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarDays aria-hidden="true" />
              <CardTitle>
                <h1>{copy.title}</h1>
              </CardTitle>
            </div>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const speakerProfiles =
    configuration.kind === "speaker-list" || configuration.kind === "speaker-gallery"
      ? await publishedSpeakerProfiles(eventSlug, configuration)
      : null;
  const speakerList = configuration.kind === "speaker-list" ? speakerProfiles : null;
  const speakerGallery = configuration.kind === "speaker-gallery" ? speakerProfiles : null;
  const sessionList = configuration.kind === "session-list" ? await publishedSessionList(eventSlug) : null;
  const itinerary = configuration.kind === "itinerary" ? await publishedItinerary(eventSlug) : null;
  let content: ReactNode;
  if (speakerGallery?.status === "available") {
    content = (
      <PublishedSpeakerGallery
        density={configuration.density}
        enabledFilters={configuration.filters}
        eventName={speakerGallery.eventName}
        speakers={speakerGallery.speakers}
      />
    );
  } else if (configuration.kind === "speaker-gallery") {
    content = (
      <Card className="mx-auto w-full max-w-6xl" size={configuration.density === "compact" ? "sm" : "default"}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users aria-hidden="true" />
            <CardTitle>
              <h1>Speaker gallery unavailable</h1>
            </CardTitle>
          </div>
          <CardDescription>This event does not currently have a published speaker gallery.</CardDescription>
        </CardHeader>
      </Card>
    );
  } else if (speakerList?.status === "available") {
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
  } else if (sessionList?.status === "available") {
    content = (
      <PublishedSessionList
        density={configuration.density}
        enabledFilters={configuration.filters}
        eventName={sessionList.eventName}
        sessions={sessionList.sessions}
      />
    );
  } else if (configuration.kind === "session-list") {
    content = (
      <Card className="mx-auto w-full max-w-4xl" size={configuration.density === "compact" ? "sm" : "default"}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LayoutList aria-hidden="true" />
            <CardTitle>
              <h1>Sessions unavailable</h1>
            </CardTitle>
          </div>
          <CardDescription>This event does not currently have a published session list.</CardDescription>
        </CardHeader>
      </Card>
    );
  } else if (itinerary?.status === "available") {
    content = (
      <ItineraryWorkspace
        density={configuration.density}
        enabledFilters={configuration.filters}
        eventSlug={eventSlug}
        eventName={itinerary.eventName}
        sessions={itinerary.sessions}
        storageKey={`board-to-death:itinerary:${itinerary.eventId}`}
        timezone={itinerary.timezone}
      />
    );
  } else if (configuration.kind === "itinerary") {
    content = (
      <Card className="mx-auto w-full max-w-4xl" size={configuration.density === "compact" ? "sm" : "default"}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarDays aria-hidden="true" />
            <CardTitle>
              <h1>Itinerary unavailable</h1>
            </CardTitle>
          </div>
          <CardDescription>This event does not currently have a published schedule.</CardDescription>
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
