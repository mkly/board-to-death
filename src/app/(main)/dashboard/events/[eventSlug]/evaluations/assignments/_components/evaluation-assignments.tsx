"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { CircleAlertIcon, ClipboardCheckIcon, LockOpenIcon, ShieldAlertIcon, UsersRoundIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EvaluationAssignmentWorkspace } from "@/server/evaluations/assignments";

import { type ManageAssignmentsState, manageEvaluationAssignments, reopenEvaluationAssignment } from "../actions";
import { ReviewerReminders } from "./reviewer-reminders";

const reopenInitialState: ManageAssignmentsState = { status: "idle" };

function ReopenAssignmentButton({
  eventSlug,
  assignmentId,
  evaluationVersion,
}: {
  readonly eventSlug: string;
  readonly assignmentId: string;
  readonly evaluationVersion: number;
}) {
  const [state, setState] = useState<ManageAssignmentsState>(reopenInitialState);
  const [pending, startTransition] = useTransition();

  function handleReopen() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("eventSlug", eventSlug);
      formData.set("assignmentId", assignmentId);
      formData.set("expectedEvaluationVersion", String(evaluationVersion));
      setState(await reopenEvaluationAssignment(state, formData));
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label="Reopen evaluation for this reviewer and return it for correction"
      title={state.status === "error" ? state.message : "Return evaluation for correction"}
      onClick={handleReopen}
    >
      {pending ? <Spinner data-icon="inline-start" /> : <LockOpenIcon data-icon="inline-start" />}
      Return for correction
    </Button>
  );
}

interface EvaluationAssignmentsProps {
  readonly event: { readonly id: string; readonly name: string; readonly slug: string };
  readonly workspace: EvaluationAssignmentWorkspace;
}

type Operation = "assign" | "assign-committee" | "auto-distribute" | "reassign" | "withdraw";

const initialState: ManageAssignmentsState = { status: "idle" };

function labelForEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

const coverageCards = [
  { key: "underAssigned", title: "Under-assigned", description: "No active reviewer coverage" },
  { key: "assigned", title: "Assigned", description: "Ready for reviewer work" },
  { key: "inProgress", title: "In progress", description: "Draft or partial evaluations" },
  { key: "complete", title: "Complete", description: "Every assignment submitted" },
] as const;

export function EvaluationAssignments({ event, workspace }: EvaluationAssignmentsProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(manageEvaluationAssignments, initialState);
  const [operation, setOperation] = useState<Operation>("assign");
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [distributionReviewerIds, setDistributionReviewerIds] = useState<readonly string[]>([]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = workspace.submissions.length > 0 && selectedIds.length === workspace.submissions.length;
  let selectAllChecked: boolean | "indeterminate" = false;
  if (allSelected) selectAllChecked = true;
  else if (selectedIds.length > 0) selectAllChecked = "indeterminate";
  const selectedSubmissions = workspace.submissions.filter(({ id }) => selectedIdSet.has(id));
  const commonAssignedReviewerIds = useMemo(() => {
    if (selectedSubmissions.length === 0) return new Set<string>();
    const [first, ...rest] = selectedSubmissions;
    const common = new Set(
      first?.assignments.filter(({ status }) => status === "ASSIGNED").map(({ reviewerId }) => reviewerId),
    );
    for (const submission of rest) {
      const ids = new Set(
        submission.assignments.filter(({ status }) => status === "ASSIGNED").map(({ reviewerId }) => reviewerId),
      );
      for (const reviewerId of common) if (!ids.has(reviewerId)) common.delete(reviewerId);
    }
    return common;
  }, [selectedSubmissions]);
  const commonReassignableReviewerIds = useMemo(() => {
    if (selectedSubmissions.length === 0) return new Set<string>();
    const [first, ...rest] = selectedSubmissions;
    const common = new Set(
      first?.assignments
        .filter(({ status }) => status === "ASSIGNED" || status === "RECUSED")
        .map(({ reviewerId }) => reviewerId),
    );
    for (const submission of rest) {
      const ids = new Set(
        submission.assignments
          .filter(({ status }) => status === "ASSIGNED" || status === "RECUSED")
          .map(({ reviewerId }) => reviewerId),
      );
      for (const reviewerId of common) if (!ids.has(reviewerId)) common.delete(reviewerId);
    }
    return common;
  }, [selectedSubmissions]);
  const sourceReviewerIds = operation === "reassign" ? commonReassignableReviewerIds : commonAssignedReviewerIds;

  useEffect(() => {
    if (state.status === "success") {
      setSelectedIds([]);
      setDistributionReviewerIds([]);
    }
  }, [state]);

  function toggleSubmission(submissionId: string, checked: boolean) {
    setSelectedIds((current) => (checked ? [...current, submissionId] : current.filter((id) => id !== submissionId)));
  }

  function toggleDistributionReviewer(reviewerId: string, checked: boolean) {
    setDistributionReviewerIds((current) =>
      checked ? [...current, reviewerId] : current.filter((id) => id !== reviewerId),
    );
  }

  function changeRound(roundId: string) {
    router.replace(
      `/dashboard/events/${encodeURIComponent(event.slug)}/evaluations/assignments?round=${encodeURIComponent(roundId)}`,
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Reviewer assignments</h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            Assign individual reviewers or committees and monitor evaluation coverage for the selected open round.
          </p>
        </div>
        {workspace.rounds.length > 0 ? (
          <Field className="w-full lg:w-72">
            <FieldLabel htmlFor="evaluation-round">Open round</FieldLabel>
            <NativeSelect
              id="evaluation-round"
              className="w-full"
              value={workspace.selectedRoundId ?? ""}
              onChange={(event) => changeRound(event.currentTarget.value)}
            >
              {workspace.rounds.map((round) => (
                <NativeSelectOption key={round.id} value={round.id}>
                  {round.planTitle} · {round.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </header>

      {workspace.rounds.length === 0 ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheckIcon />
            </EmptyMedia>
            <EmptyTitle>No open evaluation round</EmptyTitle>
            <EmptyDescription>
              Activate an evaluation plan and open a round before assigning reviewers.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {workspace.rounds.length > 0 && workspace.submissions.length === 0 ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheckIcon />
            </EmptyMedia>
            <EmptyTitle>No eligible submissions</EmptyTitle>
            <EmptyDescription>Submitted and under-review proposals will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {workspace.selectedRoundId ? (
        <ReviewerReminders eventSlug={event.slug} roundId={workspace.selectedRoundId} workspace={workspace.reminders} />
      ) : null}
      {workspace.submissions.length > 0 ? (
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="eventSlug" value={event.slug} />
          <input type="hidden" name="roundId" value={workspace.selectedRoundId ?? ""} />
          {selectedIds.map((submissionId) => (
            <input key={submissionId} type="hidden" name="submissionIds" value={submissionId} />
          ))}

          {workspace.reviewers.length === 0 ? (
            <Alert>
              <UsersRoundIcon />
              <AlertTitle>No active reviewers</AlertTitle>
              <AlertDescription>Add or reactivate an event reviewer before creating assignments.</AlertDescription>
            </Alert>
          ) : null}

          {state.message ? (
            <Alert variant={state.status === "error" ? "destructive" : "default"}>
              {state.status === "error" ? <CircleAlertIcon /> : <ClipboardCheckIcon />}
              <AlertTitle>{state.status === "error" ? "Assignments not updated" : "Assignments updated"}</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}

          <section aria-label="Evaluation coverage" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {coverageCards.map((card) => (
              <Card key={card.key} size="sm" aria-label={`${card.title}: ${workspace.coverage[card.key]}`}>
                <CardHeader>
                  <CardDescription>{card.title}</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{workspace.coverage[card.key]}</CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground text-xs">{card.description}</CardContent>
              </Card>
            ))}
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Bulk action</CardTitle>
              <CardDescription>
                {operation === "auto-distribute"
                  ? "Distribute uncovered submissions in the selected round"
                  : `${selectedIds.length} submissions selected`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-4 md:grid-cols-4">
                <Field>
                  <FieldLabel htmlFor="assignment-operation">Action</FieldLabel>
                  <NativeSelect
                    id="assignment-operation"
                    name="operation"
                    className="w-full"
                    value={operation}
                    onChange={(event) => setOperation(event.currentTarget.value as Operation)}
                  >
                    <NativeSelectOption value="assign">Assign reviewer</NativeSelectOption>
                    <NativeSelectOption value="assign-committee">Assign committee</NativeSelectOption>
                    <NativeSelectOption value="auto-distribute">Auto-distribute</NativeSelectOption>
                    <NativeSelectOption value="reassign">Reassign reviewer</NativeSelectOption>
                    <NativeSelectOption value="withdraw">Withdraw reviewer</NativeSelectOption>
                  </NativeSelect>
                </Field>
                {operation === "reassign" || operation === "withdraw" ? (
                  <Field>
                    <FieldLabel htmlFor="source-reviewer">Current reviewer</FieldLabel>
                    <NativeSelect id="source-reviewer" name="fromReviewerId" className="w-full" defaultValue="">
                      <NativeSelectOption value="" disabled>
                        Select current reviewer
                      </NativeSelectOption>
                      {workspace.reviewers
                        .filter(({ id }) => sourceReviewerIds.has(id))
                        .map((reviewer) => (
                          <NativeSelectOption key={reviewer.id} value={reviewer.id}>
                            {reviewer.displayName}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                    {selectedIds.length > 0 && sourceReviewerIds.size === 0 ? (
                      <FieldDescription>
                        {operation === "reassign"
                          ? "No active or recused reviewer is assigned to every selected submission."
                          : "No reviewer is actively assigned to every selected submission."}
                      </FieldDescription>
                    ) : null}
                  </Field>
                ) : null}
                {operation === "assign-committee" ? (
                  <Field>
                    <FieldLabel htmlFor="target-committee">Reviewer committee</FieldLabel>
                    <NativeSelect id="target-committee" name="committeeId" className="w-full" defaultValue="">
                      <NativeSelectOption value="" disabled>
                        Select committee
                      </NativeSelectOption>
                      {workspace.committees.map((committee) => (
                        <NativeSelectOption key={committee.id} value={committee.id}>
                          {committee.name} · {committee.activeMemberCount} active
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    {workspace.committees.length === 0 ? (
                      <FieldDescription>No committee has active reviewers.</FieldDescription>
                    ) : null}
                  </Field>
                ) : null}
                {operation === "auto-distribute" ? (
                  <>
                    <FieldSet className="md:col-span-2">
                      <FieldLegend variant="label">Reviewers</FieldLegend>
                      <FieldDescription>
                        Assignments go to the reviewer with the lightest current load.
                      </FieldDescription>
                      <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
                        {workspace.reviewers.map((reviewer) => (
                          <Field key={reviewer.id} orientation="horizontal">
                            <Checkbox
                              id={`distribution-reviewer-${reviewer.id}`}
                              name="reviewerIds"
                              value={reviewer.id}
                              checked={distributionReviewerIds.includes(reviewer.id)}
                              onCheckedChange={(checked) => toggleDistributionReviewer(reviewer.id, checked === true)}
                            />
                            <FieldLabel htmlFor={`distribution-reviewer-${reviewer.id}`} className="font-normal">
                              {reviewer.displayName}
                            </FieldLabel>
                          </Field>
                        ))}
                      </FieldGroup>
                    </FieldSet>
                    <Field>
                      <FieldLabel htmlFor="distribution-track">Track</FieldLabel>
                      <NativeSelect id="distribution-track" name="trackId" className="w-full" defaultValue="">
                        <NativeSelectOption value="">All tracks</NativeSelectOption>
                        {workspace.tracks.map((track) => (
                          <NativeSelectOption key={track.id} value={track.id}>
                            {track.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <FieldDescription>Tracks use the CFP categories attached to submissions.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="per-reviewer-cap">Per-reviewer cap</FieldLabel>
                      <Input id="per-reviewer-cap" name="perReviewerCap" type="number" min={1} step={1} />
                      <FieldDescription>Optional maximum assignments per reviewer in this round.</FieldDescription>
                    </Field>
                  </>
                ) : null}
                {operation !== "withdraw" && operation !== "assign-committee" && operation !== "auto-distribute" ? (
                  <Field>
                    <FieldLabel htmlFor="target-reviewer">
                      {operation === "reassign" ? "Replacement reviewer" : "Reviewer"}
                    </FieldLabel>
                    <NativeSelect id="target-reviewer" name="reviewerId" className="w-full" defaultValue="">
                      <NativeSelectOption value="" disabled>
                        Select reviewer
                      </NativeSelectOption>
                      {workspace.reviewers.map((reviewer) => (
                        <NativeSelectOption key={reviewer.id} value={reviewer.id}>
                          {reviewer.displayName} · {reviewer.email}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : null}
              </FieldGroup>
              <div className="mt-4 flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    pending ||
                    (operation !== "auto-distribute" && selectedIds.length === 0) ||
                    (operation === "auto-distribute" && distributionReviewerIds.length === 0) ||
                    workspace.reviewers.length === 0 ||
                    (operation === "assign-committee" && workspace.committees.length === 0) ||
                    ((operation === "reassign" || operation === "withdraw") && sourceReviewerIds.size === 0)
                  }
                >
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  {pending ? "Updating" : "Apply action"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Eligible submissions</CardTitle>
              <CardDescription>Only submitted and under-review proposals can receive assignments.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableCaption>{workspace.submissions.length} eligible submissions</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 pl-4">
                      <Checkbox
                        aria-label="Select all eligible submissions"
                        checked={selectAllChecked}
                        onCheckedChange={(checked) =>
                          setSelectedIds(checked === true ? workspace.submissions.map(({ id }) => id) : [])
                        }
                      />
                    </TableHead>
                    <TableHead>Submission</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Coverage</TableHead>
                    <TableHead>Categories</TableHead>
                    <TableHead>Assigned reviewers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspace.submissions.map((submission) => (
                    <TableRow
                      key={submission.id}
                      data-state={selectedIdSet.has(submission.id) ? "selected" : undefined}
                    >
                      <TableCell className="pl-4">
                        <Checkbox
                          aria-label={`Select submission ${submission.id}`}
                          checked={selectedIdSet.has(submission.id)}
                          onCheckedChange={(checked) => toggleSubmission(submission.id, checked === true)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-52 flex-col gap-1">
                          <span className="font-medium">{submission.primarySpeaker ?? "Speaker not attached"}</span>
                          <span className="text-muted-foreground text-xs">
                            {submission.formTitle} · {labelForEnum(submission.kind)} · {submission.id.slice(0, 8)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{labelForEnum(submission.status)}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-28 flex-col gap-1">
                          <Badge variant={submission.coverageStatus === "IN_PROGRESS" ? "default" : "secondary"}>
                            {labelForEnum(submission.coverageStatus)}
                          </Badge>
                          <span className="text-muted-foreground text-xs">
                            {submission.completedAssignmentCount}/{submission.assignments.length} complete
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-56 flex-wrap gap-1">
                          {submission.categories.length > 0 ? (
                            submission.categories.map((category) => (
                              <Badge key={category} variant="secondary">
                                {category}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-64 flex-wrap items-center gap-1">
                          {submission.assignments.length > 0 ? (
                            submission.assignments.map((assignment) => (
                              <span key={assignment.id} className="flex items-center gap-1">
                                <Badge variant={assignment.status === "RECUSED" ? "outline" : "secondary"}>
                                  {assignment.status === "RECUSED" ? (
                                    <ShieldAlertIcon data-icon="inline-start" />
                                  ) : null}
                                  {assignment.reviewerName}
                                  {assignment.committeeName ? ` · ${assignment.committeeName}` : ""}
                                  {assignment.status === "COMPLETED" ? " · completed" : ""}
                                  {assignment.status === "RECUSED" ? " · conflict" : ""}
                                </Badge>
                                {assignment.status === "COMPLETED" && assignment.evaluationVersion !== null ? (
                                  <ReopenAssignmentButton
                                    eventSlug={event.slug}
                                    assignmentId={assignment.id}
                                    evaluationVersion={assignment.evaluationVersion}
                                  />
                                ) : null}
                              </span>
                            ))
                          ) : (
                            <span className="text-muted-foreground">Unassigned</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </form>
      ) : null}
    </main>
  );
}
