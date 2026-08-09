import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getDatabaseClient } from "@/server/database/client";
import { ProgramSessionRepository } from "@/server/sessions/repositories";
import { SpeakerRepository } from "@/server/speakers/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { SessionWorkspace } from "./_components/session-workspace";

interface SessionsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ sessionId?: string }>;
}

export default async function SessionsPage({ params, searchParams }: SessionsPageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  // Bounded pages, not whole tables: see performance/budgets.json for the caps.
  const [sessionPage, speakerPage, tracks] = await Promise.all([
    new ProgramSessionRepository(client).listPage(event.id, { includeArchived: true }),
    new SpeakerRepository(client).listPage(event.id),
    client.track.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const sessions = sessionPage.items;
  const speakers = speakerPage.items;
  const truncated = sessionPage.hasMore || speakerPage.hasMore;
  const speakerNames = new Map(
    speakers.map((speaker) => [
      speaker.id,
      speaker.profile.preferredName ?? `${speaker.profile.givenName} ${speaker.profile.familyName}`,
    ]),
  );
  const trackNames = new Map(tracks.map((track) => [track.id, track.name]));

  return (
    <div className="flex flex-col gap-6">
      {truncated ? (
        <Alert>
          <AlertTitle>Showing the first {sessions.length} sessions</AlertTitle>
          <AlertDescription>
            This event has more sessions or speakers than this screen loads at once. Use search and the CFP exports to
            reach the rest.
          </AlertDescription>
        </Alert>
      ) : null}
      <SessionWorkspace
        event={{ name: event.name, slug: event.slug }}
        initialSessionId={query.sessionId}
        speakers={speakers.map((speaker) => ({
          id: speaker.id,
          name: speakerNames.get(speaker.id) ?? speaker.profile.email,
          email: speaker.profile.email,
        }))}
        tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
        sessions={sessions.map((session) => ({
          id: session.id,
          kind: session.kind,
          archived: session.archivedAt !== null,
          title: session.version.title,
          description: session.version.description,
          durationMinutes: session.version.durationMinutes,
          trackId: session.version.trackId,
          trackName: session.version.trackId ? (trackNames.get(session.version.trackId) ?? "Unknown track") : null,
          speakerIds: session.version.speakerIds,
          speakerNames: session.version.speakerIds.map((speakerId) => speakerNames.get(speakerId) ?? "Unknown speaker"),
          versionNumber: session.version.versionNumber,
        }))}
      />
    </div>
  );
}
