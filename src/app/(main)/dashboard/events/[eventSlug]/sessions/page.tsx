import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CustomFieldEntityType } from "@/generated/prisma/client";
import { CustomFieldRepository } from "@/server/custom-fields/repositories";
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
  const [sessionPage, speakerPage, tracks, customFieldDefinitions] = await Promise.all([
    new ProgramSessionRepository(client).listPage(event.id, { includeArchived: true }),
    new SpeakerRepository(client).listPage(event.id),
    client.track.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    new CustomFieldRepository(client).listDefinitions(event.id, CustomFieldEntityType.PROGRAM_SESSION),
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
  const customFieldValues = await client.customFieldValue.findMany({
    where: { eventId: event.id, sessionId: { in: sessions.map(({ id }) => id) } },
    select: { id: true, sessionId: true, definitionId: true, value: true },
  });
  const sessionTitles = new Map(sessions.map((session) => [session.id, session.version.title]));

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
        customFieldDefinitions={customFieldDefinitions.map((definition) => ({
          id: definition.id,
          label: definition.label,
          description: definition.description,
          type: definition.type,
          required: definition.required,
          characterLimit: definition.characterLimit,
          options:
            Array.isArray(definition.options) && definition.options.every((option) => typeof option === "string")
              ? definition.options
              : [],
        }))}
        sessions={sessions.map((session) => ({
          id: session.id,
          kind: session.kind,
          contentApprovalStatus: session.contentApprovalStatus,
          archived: session.archivedAt !== null,
          title: session.version.title,
          description: session.version.description,
          durationMinutes: session.version.durationMinutes,
          trackId: session.version.trackId,
          trackName: session.version.trackId ? (trackNames.get(session.version.trackId) ?? "Unknown track") : null,
          parentSessionId: session.parentSessionId,
          parentSessionTitle: session.parentSessionId
            ? (sessionTitles.get(session.parentSessionId) ?? "Unknown parent")
            : null,
          participants: session.version.participants.map(({ speakerId, role }) => ({
            speakerId,
            speakerName: speakerNames.get(speakerId) ?? "Unknown speaker",
            role,
          })),
          versionNumber: session.version.versionNumber,
          versions: session.versions.map((version) => ({
            versionNumber: version.versionNumber,
            title: version.title,
            description: version.description,
            createdAt: version.createdAt.toISOString(),
            createdBy: version.createdBy,
            restoredFromVersionNumber: version.restoredFromVersionNumber,
          })),
          customFieldValues: customFieldValues
            .filter((value) => value.sessionId === session.id)
            .map(({ id, definitionId, value }) => ({ id, definitionId, value })),
        }))}
      />
    </div>
  );
}
