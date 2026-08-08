"use client";

import { useActionState, useMemo, useState, useTransition } from "react";

import { Archive, CalendarClock, FilePlus2, Save } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { archiveProgramSession, type SessionMutationState, saveProgramSession } from "../actions";

export interface SessionWorkspaceSession {
  readonly id: string;
  readonly kind: "MANUAL" | "GUARANTEED" | "PROMOTED";
  readonly archived: boolean;
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly trackId: string | null;
  readonly trackName: string | null;
  readonly speakerIds: readonly string[];
  readonly speakerNames: readonly string[];
  readonly versionNumber: number;
}

interface SessionWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly sessions: readonly SessionWorkspaceSession[];
  readonly speakers: readonly { readonly id: string; readonly name: string; readonly email: string }[];
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
}

type SessionFilter = "all" | "manual" | "guaranteed" | "promoted" | "archived";

const INITIAL_MUTATION_STATE: SessionMutationState = { status: "idle" };

function kindLabel(kind: SessionWorkspaceSession["kind"]): string {
  if (kind === "GUARANTEED") return "Guaranteed";
  if (kind === "PROMOTED") return "Promoted abstract";
  return "Manual";
}

function fieldError(state: SessionMutationState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function saveButtonLabel(pending: boolean, isNew: boolean): string {
  if (pending) return "Saving...";
  return isNew ? "Create session" : "Save new version";
}

function matchesFilter(session: SessionWorkspaceSession, filter: SessionFilter): boolean {
  if (filter === "archived") return session.archived;
  if (session.archived) return false;
  if (filter === "all") return true;
  return session.kind === filter.toUpperCase();
}

function SessionForm({
  eventSlug,
  session,
  speakers,
  tracks,
  onSaved,
}: {
  readonly eventSlug: string;
  readonly session: SessionWorkspaceSession | null;
  readonly speakers: SessionWorkspaceProps["speakers"];
  readonly tracks: SessionWorkspaceProps["tracks"];
  readonly onSaved: (sessionId: string) => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (previousState: SessionMutationState, formData: FormData) => {
      const result = await saveProgramSession(previousState, formData);
      if (result.status === "success" && result.sessionId) onSaved(result.sessionId);
      return result;
    },
    INITIAL_MUTATION_STATE,
  );
  const isNew = session === null;

  return (
    <form action={formAction}>
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="sessionId" value={session?.id ?? ""} />
      <Card>
        <CardHeader>
          <CardTitle>{isNew ? "Create manual session" : session.title}</CardTitle>
          <CardDescription>
            {isNew
              ? "Add a session without a CFP submission. Scheduling can be completed later in Agenda."
              : `${kindLabel(session.kind)} session · version ${session.versionNumber}`}
          </CardDescription>
          {!isNew ? (
            <CardAction>
              <Badge variant={session.archived ? "secondary" : "outline"}>
                {session.archived ? "Archived" : kindLabel(session.kind)}
              </Badge>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={Boolean(fieldError(state, "title")) || undefined}>
              <FieldLabel htmlFor="session-title">Title</FieldLabel>
              <Input
                id="session-title"
                name="title"
                defaultValue={session?.title ?? ""}
                aria-invalid={Boolean(fieldError(state, "title")) || undefined}
                disabled={session?.archived}
                required
              />
              <FieldError>{fieldError(state, "title")}</FieldError>
            </Field>
            <Field data-invalid={Boolean(fieldError(state, "description")) || undefined}>
              <FieldLabel htmlFor="session-description">Description</FieldLabel>
              <Textarea
                id="session-description"
                name="description"
                defaultValue={session?.description ?? ""}
                aria-invalid={Boolean(fieldError(state, "description")) || undefined}
                disabled={session?.archived}
                className="min-h-28"
              />
              <FieldError>{fieldError(state, "description")}</FieldError>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={Boolean(fieldError(state, "durationMinutes")) || undefined}>
                <FieldLabel htmlFor="session-duration">Duration (minutes)</FieldLabel>
                <Input
                  id="session-duration"
                  name="durationMinutes"
                  type="number"
                  min={1}
                  max={1440}
                  step={1}
                  defaultValue={session?.durationMinutes ?? 45}
                  aria-invalid={Boolean(fieldError(state, "durationMinutes")) || undefined}
                  disabled={session?.archived}
                  required
                />
                <FieldError>{fieldError(state, "durationMinutes")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(fieldError(state, "trackId")) || undefined}>
                <FieldLabel htmlFor="session-track">Track</FieldLabel>
                <Select name="trackId" defaultValue={session?.trackId ?? "unassigned"} disabled={session?.archived}>
                  <SelectTrigger id="session-track" aria-invalid={Boolean(fieldError(state, "trackId")) || undefined}>
                    <SelectValue placeholder="No track" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="unassigned">No track</SelectItem>
                      {tracks.map((track) => (
                        <SelectItem key={track.id} value={track.id}>
                          {track.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Optional until the program is organized.</FieldDescription>
                <FieldError>{fieldError(state, "trackId")}</FieldError>
              </Field>
            </div>
            <FieldSet>
              <FieldLegend variant="label">Participants</FieldLegend>
              <FieldDescription>Select speakers from this event in display order.</FieldDescription>
              {speakers.length === 0 ? (
                <p className="text-muted-foreground text-sm">No event speakers are available yet.</p>
              ) : (
                <FieldGroup className="gap-3">
                  {speakers.map((speaker) => (
                    <Field
                      key={speaker.id}
                      orientation="horizontal"
                      data-disabled={session?.archived ? true : undefined}
                    >
                      <Checkbox
                        id={`session-speaker-${speaker.id}`}
                        name="speakerIds"
                        value={speaker.id}
                        defaultChecked={session?.speakerIds.includes(speaker.id)}
                        disabled={session?.archived}
                      />
                      <FieldLabel htmlFor={`session-speaker-${speaker.id}`} className="font-normal">
                        {speaker.name}
                        <span className="text-muted-foreground">{speaker.email}</span>
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              )}
              <FieldError>{fieldError(state, "speakerIds")}</FieldError>
            </FieldSet>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {state.message}
          </p>
          {!session?.archived ? (
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              {saveButtonLabel(pending, isNew)}
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </form>
  );
}

export function SessionWorkspace({ event, sessions, speakers, tracks }: SessionWorkspaceProps) {
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState("");
  const [archivePending, startArchiveTransition] = useTransition();
  const filteredSessions = useMemo(
    () => sessions.filter((session) => matchesFilter(session, filter)),
    [filter, sessions],
  );
  const selectedSession = sessions.find(({ id }) => id === selectedSessionId) ?? null;

  const inspect = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setCreating(false);
    setArchiveMessage("");
  };

  const startCreating = () => {
    setSelectedSessionId(null);
    setCreating(true);
    setArchiveMessage("");
  };

  const archiveSelected = () => {
    if (!selectedSession) return;
    startArchiveTransition(async () => {
      const result = await archiveProgramSession(event.slug, selectedSession.id);
      setArchiveMessage(result.message ?? "");
      if (result.status === "success") setSelectedSessionId(null);
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Sessions</h1>
          <p className="text-muted-foreground text-sm">
            Guaranteed and manual sessions live here separately from abstract submissions.
          </p>
        </div>
        <Button type="button" onClick={startCreating}>
          <FilePlus2 data-icon="inline-start" />
          New manual session
        </Button>
      </header>

      <div className="flex flex-col gap-3">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as SessionFilter);
          }}
          variant="outline"
          size="sm"
          className="max-w-full flex-wrap"
          aria-label="Filter sessions"
        >
          <ToggleGroupItem value="all">All active</ToggleGroupItem>
          <ToggleGroupItem value="manual">Manual</ToggleGroupItem>
          <ToggleGroupItem value="guaranteed">Guaranteed</ToggleGroupItem>
          <ToggleGroupItem value="promoted">Promoted</ToggleGroupItem>
          <ToggleGroupItem value="archived">Archived</ToggleGroupItem>
        </ToggleGroup>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {filteredSessions.length} {filteredSessions.length === 1 ? "session" : "sessions"}
        </p>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <Card className="min-w-0 self-start">
          <CardHeader>
            <CardTitle>Event sessions</CardTitle>
            <CardDescription>Inspect a row to see its full event-scoped details and version history.</CardDescription>
          </CardHeader>
          <CardContent>
            {filteredSessions.length === 0 ? (
              <Empty className="min-h-56">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CalendarClock />
                  </EmptyMedia>
                  <EmptyTitle>No sessions in this view</EmptyTitle>
                  <EmptyDescription>Choose another filter or create a manual session.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Track</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSessions.map((session) => (
                    <TableRow key={session.id} data-state={selectedSessionId === session.id ? "selected" : undefined}>
                      <TableCell>
                        <div className="flex min-w-48 flex-col gap-1 whitespace-normal">
                          <span className="font-medium">{session.title}</span>
                          <span className="text-muted-foreground text-xs">
                            {session.speakerNames.length === 0 ? "No participants" : session.speakerNames.join(", ")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={session.archived ? "secondary" : "outline"}>
                          {session.archived ? "Archived" : kindLabel(session.kind)}
                        </Badge>
                      </TableCell>
                      <TableCell>{session.durationMinutes} min</TableCell>
                      <TableCell>{session.trackName ?? "Unassigned"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Inspect ${session.title}`}
                          onClick={() => inspect(session.id)}
                        >
                          Inspect
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          {creating || selectedSession ? (
            <SessionForm
              key={selectedSession?.id ?? "new"}
              eventSlug={event.slug}
              session={selectedSession}
              speakers={speakers}
              tracks={tracks}
              onSaved={(sessionId) => {
                setSelectedSessionId(sessionId);
                setCreating(false);
              }}
            />
          ) : (
            <Empty className="min-h-80 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClock />
                </EmptyMedia>
                <EmptyTitle>Inspect or create a session</EmptyTitle>
                <EmptyDescription>
                  Choose a session from the table to review its details, or add a manual session.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {selectedSession && !selectedSession.archived ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <p aria-live="polite" className="text-muted-foreground text-sm">
                {archiveMessage || "Archiving preserves every saved version."}
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" size="sm" disabled={archivePending}>
                    {archivePending ? <Spinner data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
                    Archive
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive {selectedSession.title}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The session leaves active views but its versions remain available in the archived filter.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={archiveSelected}>
                      Archive session
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
