import { CalendarDays, LayoutList, Users } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  EMBED_KIND_LABELS,
  type EmbedConfiguration,
  type EmbedKind,
  parseEmbedSearchParams,
} from "@/lib/published-embeds/configuration";
import { cn } from "@/lib/utils";
import { getDatabaseClient } from "@/server/database/client";
import { PublishedProgramRepository, type PublishedProgramSnapshot } from "@/server/published-program";

import { EmbedFrameBridge } from "../_components/embed-frame-bridge";
import { AgendaEmbed } from "./_components/agenda-embed";

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

function embedInstance(value: string | string[] | undefined): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : "preview";
}

function EmbedState({
  configuration,
  eventSlug,
  instance,
  title,
  description,
}: {
  readonly configuration: EmbedConfiguration;
  readonly eventSlug: string;
  readonly instance: string;
  readonly title: string;
  readonly description: string;
}) {
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
      <Card size={configuration.density === "compact" ? "sm" : "default"}>
        <CardHeader>
          <CardTitle>
            <h1>{eventSlug}</h1>
          </CardTitle>
          <CardDescription>Published agenda</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDays />
              </EmptyMedia>
              <EmptyTitle>{title}</EmptyTitle>
              <EmptyDescription>{description}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </main>
  );
}

function PlaceholderEmbed({
  configuration,
  eventSlug,
  instance,
}: {
  readonly configuration: EmbedConfiguration;
  readonly eventSlug: string;
  readonly instance: string;
}) {
  const Icon = KIND_ICONS[configuration.kind];

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
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon />
              </EmptyMedia>
              <EmptyTitle>Your published content will appear here</EmptyTitle>
              <EmptyDescription>This widget will be available when its published view is enabled.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </main>
  );
}

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
  const instance = embedInstance(rawSearchParams.instance);

  if (configuration.kind !== "agenda") {
    return <PlaceholderEmbed configuration={configuration} eventSlug={eventSlug} instance={instance} />;
  }

  const result = await new PublishedProgramRepository(getDatabaseClient()).findPublic(eventSlug);
  if (result.status === "event-not-found") {
    return (
      <EmbedState
        configuration={configuration}
        eventSlug={eventSlug}
        instance={instance}
        title="Event not found"
        description="Check the embed URL and try again."
      />
    );
  }
  if (result.status === "not-published") {
    return (
      <EmbedState
        configuration={configuration}
        eventSlug={eventSlug}
        instance={instance}
        title="Agenda not published"
        description="This event does not have a published agenda yet."
      />
    );
  }
  if (result.status === "unpublished") {
    return (
      <EmbedState
        configuration={configuration}
        eventSlug={eventSlug}
        instance={instance}
        title="Agenda unavailable"
        description="The organizer has taken this agenda offline."
      />
    );
  }

  return (
    <AgendaEmbed
      configuration={configuration}
      data={agendaData(result.version.snapshot)}
      instance={instance}
      publishedAt={result.version.createdAt.toISOString()}
    />
  );
}
