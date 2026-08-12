"use client";

import { useActionState, useEffect, useRef } from "react";

import { useRouter } from "next/navigation";

import { Ban, RefreshCw } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useActionToast } from "@/hooks/use-action-toast";
import type { SyncRunRecordSummary, SyncRunSummary } from "@/server/integrations";

import { requestSyncRunCancellation, retryAcceleventsSyncRun, type SyncRunMutationState } from "../actions";

const REGION_LABEL = "Accelevents sync status";
const initialState: SyncRunMutationState = { status: "idle" };
const POLL_INTERVAL_MS = 4000;

const RUN_STATUS_LABEL: Record<SyncRunSummary["status"], string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  PARTIALLY_FAILED: "Partially failed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const RUN_STATUS_VARIANT: Record<SyncRunSummary["status"], "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  RUNNING: "secondary",
  SUCCEEDED: "default",
  PARTIALLY_FAILED: "destructive",
  FAILED: "destructive",
  CANCELLED: "outline",
};

const RECORD_STATUS_LABEL: Record<SyncRunRecordSummary["status"], string> = {
  PENDING: "Pending",
  SUCCEEDED: "Succeeded",
  SKIPPED: "Skipped",
  VALIDATION_FAILED: "Validation failed",
  RETRIABLE_FAILED: "Retriable failure",
  TERMINAL_FAILED: "Failed",
};

const RECORD_STATUS_VARIANT: Record<
  SyncRunRecordSummary["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "outline",
  SUCCEEDED: "default",
  SKIPPED: "outline",
  VALIDATION_FAILED: "destructive",
  RETRIABLE_FAILED: "destructive",
  TERMINAL_FAILED: "destructive",
};

function formatTimestamp(value: Date | string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function retryColumnText(record: SyncRunRecordSummary): string {
  if (record.alreadyRetried) return "Already retried";
  if (record.retryEligible) return "Eligible";
  if (record.status === "RETRIABLE_FAILED") return `Retry after ${formatTimestamp(record.retryAfter)}`;
  return "—";
}

interface CancelSyncRunButtonProps {
  readonly eventSlug: string;
  readonly runId: string;
}

function CancelSyncRunButton({ eventSlug, runId }: CancelSyncRunButtonProps) {
  const [state, formAction, pending] = useActionState(requestSyncRunCancellation, initialState);
  useActionToast(state);
  const formId = `cancel-sync-run-${runId}`;

  return (
    <div className="flex flex-col gap-2">
      <form id={formId} action={formAction}>
        <input type="hidden" name="eventSlug" value={eventSlug} />
        <input type="hidden" name="runId" value={runId} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <Ban data-icon="inline-start" />}
              {pending ? "Cancelling..." : "Cancel run"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <Ban />
              </AlertDialogMedia>
              <AlertDialogTitle>Cancel this sync run?</AlertDialogTitle>
              <AlertDialogDescription>
                No further records in this run will be attempted. A record already in flight may still finish.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep running</AlertDialogCancel>
              <AlertDialogAction type="submit" form={formId} variant="destructive">
                Cancel run
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </form>
    </div>
  );
}

interface RetrySyncRunButtonProps {
  readonly eventSlug: string;
  readonly runId: string;
  readonly retryEligibleCount: number;
}

function RetrySyncRunButton({ eventSlug, runId, retryEligibleCount }: RetrySyncRunButtonProps) {
  const [state, formAction, pending] = useActionState(retryAcceleventsSyncRun, initialState);
  useActionToast(state);
  const formId = `retry-sync-run-${runId}`;

  return (
    <div className="flex flex-col gap-2">
      <form id={formId} action={formAction}>
        <input type="hidden" name="eventSlug" value={eventSlug} />
        <input type="hidden" name="runId" value={runId} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              {pending ? "Retrying..." : `Retry ${retryEligibleCount} eligible`}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <RefreshCw />
              </AlertDialogMedia>
              <AlertDialogTitle>Retry eligible records?</AlertDialogTitle>
              <AlertDialogDescription>
                Only records eligible for retry will be attempted again. Records already retried or past their retry
                window are skipped.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not now</AlertDialogCancel>
              <AlertDialogAction type="submit" form={formId}>
                Retry eligible records
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </form>
    </div>
  );
}

interface SyncRunCardProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly run: SyncRunSummary;
}

function SyncRunCard({ event, run }: SyncRunCardProps) {
  return (
    <Card data-testid={`sync-run-${run.id}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <Badge variant={RUN_STATUS_VARIANT[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
            <span className="text-muted-foreground text-sm capitalize">{run.resourceType ?? "unknown resource"}</span>
            {run.retryOfRunId && <Badge variant="outline">retry</Badge>}
          </CardTitle>
          <CardDescription>
            Started {formatTimestamp(run.startedAt)} · Completed {formatTimestamp(run.completedAt)}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.cancellable && <CancelSyncRunButton eventSlug={event.slug} runId={run.id} />}
          {!run.cancellable && run.status === "RUNNING" && run.cancelRequestedAt && (
            <Badge variant="outline">Cancellation requested</Badge>
          )}
          {run.retryable && (
            <RetrySyncRunButton eventSlug={event.slug} runId={run.id} retryEligibleCount={run.retryEligibleCount} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {run.records.length === 0 ? (
          <p className="text-muted-foreground text-sm">This run has no records.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Local record</TableHead>
                <TableHead>Remote record</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Explanation</TableHead>
                <TableHead>Attempt</TableHead>
                <TableHead>Retry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-mono text-xs">{record.localId}</TableCell>
                  <TableCell className="font-mono text-xs">{record.remoteId ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={RECORD_STATUS_VARIANT[record.status]}>{RECORD_STATUS_LABEL[record.status]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs text-sm">{record.explanation ?? "—"}</TableCell>
                  <TableCell>{record.attemptNumber}</TableCell>
                  <TableCell className="text-sm">{retryColumnText(record)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface SyncStatusWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly runs: readonly SyncRunSummary[];
}

export function SyncStatusWorkspace({ event, runs }: SyncStatusWorkspaceProps) {
  const router = useRouter();
  const hasActiveRun = runs.some((run) => run.status === "RUNNING");
  const hasActiveRunRef = useRef(hasActiveRun);
  hasActiveRunRef.current = hasActiveRun;

  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = window.setInterval(() => {
      if (hasActiveRunRef.current) router.refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [hasActiveRun, router]);

  return (
    <section aria-label={REGION_LABEL} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-lg">{REGION_LABEL}</h2>
        <p className="text-muted-foreground text-sm">
          Sync-run history for {event.name}, including per-record outcomes and retry eligibility.
        </p>
      </div>
      {runs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RefreshCw />
            </EmptyMedia>
            <EmptyTitle>No sync runs yet</EmptyTitle>
            <EmptyDescription>Push speakers or sessions to Accelevents to see sync history here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {runs.map((run) => (
            <SyncRunCard key={run.id} event={event} run={run} />
          ))}
        </div>
      )}
    </section>
  );
}
