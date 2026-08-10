"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { CircleAlertIcon, MailCheckIcon, SendIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EvaluationReminderWorkspace } from "@/server/evaluations/reminders";

import { type SendEvaluationRemindersState, sendEvaluationReminders } from "../actions";

const initialState: SendEvaluationRemindersState = { status: "idle" };

interface ReviewerRemindersProps {
  readonly eventSlug: string;
  readonly roundId: string;
  readonly workspace: EvaluationReminderWorkspace;
}

export function ReviewerReminders({ eventSlug, roundId, workspace }: ReviewerRemindersProps) {
  const [state, formAction, pending] = useActionState(sendEvaluationReminders, initialState);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = workspace.targets.length > 0 && selectedIds.length === workspace.targets.length;
  let selectAllChecked: boolean | "indeterminate" = false;
  if (allSelected) selectAllChecked = true;
  else if (selectedIds.length > 0) selectAllChecked = "indeterminate";

  useEffect(() => {
    if (state.status === "success") setSelectedIds([]);
  }, [state]);

  function toggleReviewer(reviewerId: string, checked: boolean) {
    setSelectedIds((current) => (checked ? [...current, reviewerId] : current.filter((id) => id !== reviewerId)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reviewer progress and reminders</CardTitle>
        <CardDescription>
          Select reviewers with outstanding work and send one bulk reminder for this open round.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.message ? (
          <Alert variant={state.status === "error" ? "destructive" : "default"}>
            {state.status === "error" ? <CircleAlertIcon /> : <MailCheckIcon />}
            <AlertTitle>{state.status === "error" ? "Reminders not sent" : "Reminders queued"}</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        {workspace.targets.length > 0 ? (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="eventSlug" value={eventSlug} />
            <input type="hidden" name="roundId" value={roundId} />
            {selectedIds.map((reviewerId) => (
              <input key={reviewerId} type="hidden" name="reviewerIds" value={reviewerId} />
            ))}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      aria-label="Select all reviewers with outstanding assignments"
                      checked={selectAllChecked}
                      onCheckedChange={(checked) =>
                        setSelectedIds(checked === true ? workspace.targets.map(({ reviewerId }) => reviewerId) : [])
                      }
                    />
                  </TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Last reminder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.targets.map((target) => (
                  <TableRow
                    key={target.reviewerId}
                    data-state={selectedIdSet.has(target.reviewerId) ? "selected" : undefined}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${target.displayName} for a reminder`}
                        checked={selectedIdSet.has(target.reviewerId)}
                        onCheckedChange={(checked) => toggleReviewer(target.reviewerId, checked === true)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{target.displayName}</span>
                        <span className="text-muted-foreground text-xs">{target.email}</span>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {target.completedCount}/{target.assignedCount} complete
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">{target.outstandingCount}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {target.lastReminderAt?.toLocaleString() ?? "Never"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end">
              <Button type="submit" disabled={pending || selectedIds.length === 0}>
                {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
                {pending ? "Sending" : `Send reminders (${selectedIds.length.toString()})`}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">No reviewers have outstanding assignments in this round.</p>
        )}
      </CardContent>
      {workspace.deliveries.length > 0 ? (
        <CardFooter className="flex flex-wrap gap-2">
          <span className="mr-auto text-muted-foreground text-xs">Recent reminder deliveries</span>
          {workspace.deliveries.map((delivery) => (
            <Button key={delivery.deliveryId} asChild variant="outline" size="sm">
              <Link
                href={`/dashboard/events/${encodeURIComponent(eventSlug)}/communications/deliveries/${delivery.deliveryId}`}
              >
                {delivery.recipientCount.toString()} recipients · {delivery.createdAt.toLocaleString()}
              </Link>
            </Button>
          ))}
        </CardFooter>
      ) : null}
    </Card>
  );
}
