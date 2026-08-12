"use client";

import { useState, useTransition } from "react";

import { CalendarClock, Check, Sparkles, TriangleAlert, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Spinner } from "@/components/ui/spinner";

import { type AssistedScheduleState, acceptAssistedSchedule, previewAssistedSchedule } from "../actions";

const INITIAL_STATE: AssistedScheduleState = { status: "idle" };

function formatProposalTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

interface AssistedSchedulingCardProps {
  readonly eventSlug: string;
  readonly timezone: string;
  readonly unscheduledCount: number;
  readonly roomCount: number;
}

export function AssistedSchedulingCard({
  eventSlug,
  timezone,
  unscheduledCount,
  roomCount,
}: AssistedSchedulingCardProps) {
  const [state, setState] = useState<AssistedScheduleState>(INITIAL_STATE);
  const [pending, startTransition] = useTransition();
  const proposals = state.proposals ?? [];
  const unplaced = state.unplaced ?? [];
  const acceptLabel = proposals.length === 1 ? "Accept proposed placement" : "Accept proposed placements";

  const preview = () => {
    startTransition(async () => setState(await previewAssistedSchedule(eventSlug)));
  };
  const accept = () => {
    startTransition(async () => setState(await acceptAssistedSchedule(eventSlug, proposals)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assisted scheduling</CardTitle>
        <CardDescription>
          Propose conflict-free rooms and times for unscheduled sessions. Nothing is saved until you accept the preview.
        </CardDescription>
        <CardAction>
          <Badge variant="outline">
            {unscheduledCount} unscheduled {unscheduledCount === 1 ? "session" : "sessions"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.status === "error" ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Assisted schedule not available</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "success" ? (
          <Alert>
            <Check />
            <AlertTitle>Schedule accepted</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "preview" ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <p className="text-muted-foreground text-sm">{state.message}</p>
            {proposals.length > 0 ? (
              <ol className="grid gap-2 md:grid-cols-2">
                {proposals.map((proposal) => (
                  <li key={proposal.sessionId} className="flex min-w-0 flex-col gap-1 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium text-sm">{proposal.title}</p>
                      <Badge variant="secondary">{proposal.durationMinutes} min</Badge>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {formatProposalTime(proposal.startsAt, timezone)} · {proposal.roomName}
                    </p>
                  </li>
                ))}
              </ol>
            ) : null}
            {unplaced.length > 0 ? (
              <Alert>
                <CalendarClock />
                <AlertTitle>
                  {unplaced.length} {unplaced.length === 1 ? "session needs" : "sessions need"} manual placement
                </AlertTitle>
                <AlertDescription>
                  <ul className="flex list-disc flex-col gap-1 pl-4">
                    {unplaced.map((session) => (
                      <li key={session.sessionId}>
                        {session.title}: {session.reason}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {state.status === "preview" ? (
          <Button type="button" variant="outline" onClick={() => setState(INITIAL_STATE)} disabled={pending}>
            <X data-icon="inline-start" />
            Discard
          </Button>
        ) : null}
        {state.status === "preview" && proposals.length > 0 ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" aria-label={acceptLabel} disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                {acceptLabel}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Accept {proposals.length} proposed placements?</AlertDialogTitle>
                <AlertDialogDescription>
                  These sessions will be added to the agenda. If the agenda changed since this preview, the save will be
                  stopped so you can review a new proposal.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                <AlertDialogAction onClick={accept}>{acceptLabel}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button type="button" onClick={preview} disabled={pending || unscheduledCount === 0 || roomCount === 0}>
            {pending ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
            {pending ? "Preparing..." : "Propose schedule"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
