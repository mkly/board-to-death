import { ChartNoAxesCombinedIcon, CircleAlertIcon, CircleCheckIcon, MoveRightIcon, SendIcon } from "lucide-react";

import { FormSelect } from "@/components/form-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CfpSubmissionStatus, EvaluationDecisionOutcome } from "@/generated/prisma/client";
import type { EvaluationResultsWorkspace, EvaluationSubmissionResult } from "@/server/evaluations/results";

import {
  advanceEvaluationSubmission,
  closeEvaluationRound,
  inviteAcceptedSpeakers,
  recordEvaluationDecision,
} from "../actions";

interface EvaluationResultsProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly workspace: EvaluationResultsWorkspace;
  readonly notice?: string;
  readonly error?: string;
}

function scoreLabel(score: number | null): string {
  return score === null ? "—" : score.toFixed(2);
}

function ProgressionAction({
  eventSlug,
  roundId,
  submission,
  hasNextRound,
}: {
  readonly eventSlug: string;
  readonly roundId: string;
  readonly submission: EvaluationSubmissionResult;
  readonly hasNextRound: boolean;
}) {
  if (submission.advancedAt) return <Badge variant="secondary">Advanced</Badge>;
  if (!submission.canAdvance) {
    return (
      <span className="text-muted-foreground text-xs">{hasNextRound ? "Complete reviews first" : "Final round"}</span>
    );
  }
  return (
    <form action={advanceEvaluationSubmission.bind(null, eventSlug, roundId, submission.id)}>
      <Button type="submit" size="sm">
        <MoveRightIcon data-icon="inline-start" />
        Advance
      </Button>
    </form>
  );
}

const decisionLabels: Readonly<Record<EvaluationDecisionOutcome, string>> = {
  [EvaluationDecisionOutcome.WAITLISTED]: "Waitlisted",
  [EvaluationDecisionOutcome.ACCEPTED]: "Accepted",
  [EvaluationDecisionOutcome.REJECTED]: "Rejected",
};

const decisionActionLabels: Readonly<Record<EvaluationDecisionOutcome, string>> = {
  [EvaluationDecisionOutcome.WAITLISTED]: "Waitlist",
  [EvaluationDecisionOutcome.ACCEPTED]: "Accept",
  [EvaluationDecisionOutcome.REJECTED]: "Reject",
};

function decisionButtonVariant(outcome: EvaluationDecisionOutcome): "default" | "destructive" | "outline" {
  if (outcome === EvaluationDecisionOutcome.REJECTED) return "destructive";
  if (outcome === EvaluationDecisionOutcome.WAITLISTED) return "outline";
  return "default";
}

function DecisionAction({
  eventSlug,
  roundId,
  submission,
  hasNextRound,
}: {
  readonly eventSlug: string;
  readonly roundId: string;
  readonly submission: EvaluationSubmissionResult;
  readonly hasNextRound: boolean;
}) {
  const expectedDecisionNumber = submission.decision?.decisionNumber ?? 0;
  if (submission.availableDecisionOutcomes.length === 0) {
    if (submission.decision) {
      return (
        <div className="flex min-w-28 flex-col items-start gap-1">
          <Badge
            variant={submission.decision.outcome === EvaluationDecisionOutcome.REJECTED ? "destructive" : "secondary"}
          >
            {decisionLabels[submission.decision.outcome]}
          </Badge>
          <span className="text-muted-foreground text-xs">Decision {submission.decision.decisionNumber}</span>
        </div>
      );
    }
    return (
      <span className="text-muted-foreground text-xs">
        {hasNextRound ? "Final round only" : "Complete reviews first"}
      </span>
    );
  }

  return (
    <div className="flex min-w-52 flex-col items-start gap-2">
      {submission.decision ? (
        <Badge variant="secondary">
          {decisionLabels[submission.decision.outcome]} · Decision {submission.decision.decisionNumber}
        </Badge>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {submission.availableDecisionOutcomes.map((outcome) => (
          <form
            key={outcome}
            action={recordEvaluationDecision.bind(
              null,
              eventSlug,
              roundId,
              submission.id,
              outcome,
              expectedDecisionNumber,
            )}
          >
            <Button type="submit" size="xs" variant={decisionButtonVariant(outcome)}>
              {decisionActionLabels[outcome]}
            </Button>
          </form>
        ))}
      </div>
    </div>
  );
}

function SpeakerInvitationAction({
  eventSlug,
  roundId,
  submission,
}: {
  readonly eventSlug: string;
  readonly roundId: string;
  readonly submission: EvaluationSubmissionResult;
}) {
  if (submission.status === CfpSubmissionStatus.CONFIRMED) {
    return <Badge variant="secondary">All speakers confirmed</Badge>;
  }
  if (submission.status !== CfpSubmissionStatus.ACCEPTED) return null;

  return (
    <div className="flex min-w-36 flex-col items-start gap-2">
      <Badge variant="outline">
        {submission.confirmedParticipantCount}/{submission.participantCount} confirmed
      </Badge>
      <form action={inviteAcceptedSpeakers.bind(null, eventSlug, roundId, submission.id)}>
        <Button type="submit" size="xs" variant="outline">
          <SendIcon data-icon="inline-start" />
          {submission.confirmedParticipantCount > 0 ? "Reissue invites" : "Invite speakers"}
        </Button>
      </form>
    </div>
  );
}

export function EvaluationResults({ event, workspace, notice, error }: EvaluationResultsProps) {
  const completedReviews = workspace.submissions.reduce(
    (total, submission) => total + submission.completedReviewerCount,
    0,
  );
  const activeReviews = workspace.submissions.reduce((total, submission) => total + submission.activeReviewerCount, 0);
  const withdrawnReviews = workspace.submissions.reduce(
    (total, submission) => total + submission.withdrawnReviewerCount,
    0,
  );
  const scoredSubmissions = workspace.submissions.filter(({ weightedAverage }) => weightedAverage !== null).length;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Evaluation results</h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            Compare criterion averages, weighted totals, rankings, and reviewer completion for an activated round.
          </p>
        </div>
        {workspace.rounds.length > 0 ? (
          <form className="flex w-full items-end gap-2 lg:w-auto" method="get">
            <Field className="min-w-0 flex-1 lg:w-80">
              <FieldLabel htmlFor="results-round">Activated round</FieldLabel>
              <FormSelect
                id="results-round"
                name="round"
                defaultValue={workspace.selectedRoundId ?? ""}
                options={workspace.rounds.map((round) => ({
                  value: round.id,
                  label: `${round.planTitle} v${round.planVersionNumber} · ${round.title}`,
                }))}
              />
            </Field>
            <Button type="submit" variant="outline">
              View
            </Button>
          </form>
        ) : null}
      </header>

      {notice ? (
        <Alert>
          <CircleCheckIcon />
          <AlertTitle>Evaluation workflow updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Evaluation workflow not updated</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {workspace.workflow && workspace.selectedRoundId ? (
        <Card>
          <CardHeader>
            <CardTitle>Round progression</CardTitle>
            <CardDescription>
              Advance fully reviewed submissions without changing this round&apos;s assignments or evaluation history.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant={workspace.workflow.status === "OPEN" ? "default" : "secondary"}>
              {workspace.workflow.status.toLowerCase()}
            </Badge>
            {workspace.workflow.nextRound ? (
              <span className="text-muted-foreground text-sm">Next round: {workspace.workflow.nextRound.title}</span>
            ) : (
              <span className="text-muted-foreground text-sm">This is the final round.</span>
            )}
          </CardContent>
          {workspace.workflow.status === "OPEN" ? (
            <CardFooter className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-muted-foreground text-sm">
                {workspace.workflow.incompleteAssignmentCount === 0
                  ? "Every active reviewer assignment is complete."
                  : `${workspace.workflow.incompleteAssignmentCount} active reviewer assignments remain incomplete.`}
              </span>
              <form action={closeEvaluationRound.bind(null, event.slug, workspace.selectedRoundId)}>
                <Button type="submit" variant="outline" disabled={!workspace.workflow.canClose}>
                  <CircleCheckIcon data-icon="inline-start" />
                  Close round
                </Button>
              </form>
            </CardFooter>
          ) : null}
        </Card>
      ) : null}

      {workspace.rounds.length === 0 ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesCombinedIcon />
            </EmptyMedia>
            <EmptyTitle>No activated evaluation round</EmptyTitle>
            <EmptyDescription>
              Activate a plan and open its first round before reporting evaluation results.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {workspace.rounds.length > 0 && workspace.submissions.length === 0 ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesCombinedIcon />
            </EmptyMedia>
            <EmptyTitle>No reviewer assignments</EmptyTitle>
            <EmptyDescription>
              Assign at least one submission to the selected round to begin reporting.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {workspace.submissions.length > 0 ? (
        <>
          <section aria-label="Evaluation result summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card size="sm">
              <CardHeader>
                <CardDescription>Reviewer completion</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {completedReviews}/{activeReviews}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">
                Final reviews among active assignments
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>Incomplete reviews</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{activeReviews - completedReviews}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">Not started, partial, or reopened</CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>Scored submissions</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{scoredSubmissions}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">
                {workspace.submissions.length} submissions assigned
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>Withdrawn assignments</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{withdrawnReviews}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">
                Reported but excluded from every score
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Scoring method</CardTitle>
              <CardDescription>
                Criterion averages use every available score from non-withdrawn assignments. Missing values are excluded
                from the average and shown as missing. The total multiplies each available criterion average by its
                activated rubric weight, divides by the available weight, and rounds to two decimals. Criteria with no
                scores are omitted from the total. Equal rounded totals share a competition rank and are marked as ties.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Submission scores</CardTitle>
              <CardDescription>Sorted by weighted average; submissions without scores appear last.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-(--card-spacing)">Submission</TableHead>
                    <TableHead>Reviewer completion</TableHead>
                    {workspace.criteria.map((criterion) => (
                      <TableHead key={criterion.id}>
                        {criterion.label}
                        <span className="block font-normal text-muted-foreground text-xs">
                          Weight {criterion.weight}
                        </span>
                      </TableHead>
                    ))}
                    <TableHead>Weighted average</TableHead>
                    <TableHead>Rank</TableHead>
                    <TableHead>Progression</TableHead>
                    <TableHead>Speaker confirmation</TableHead>
                    <TableHead className="pr-(--card-spacing)">Final decision</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspace.submissions.map((submission) => (
                    <TableRow key={submission.id}>
                      <TableCell className="pl-(--card-spacing)">
                        <div className="flex min-w-48 flex-col gap-1 whitespace-normal">
                          <span className="font-medium">{submission.reference}</span>
                          <span className="text-muted-foreground text-xs">
                            {submission.primarySpeaker ?? submission.formTitle}
                          </span>
                          {submission.categories.length > 0 ? (
                            <span className="text-muted-foreground text-xs">{submission.categories.join(", ")}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-32 flex-col items-start gap-1">
                          <Badge variant={submission.incompleteReviewerCount === 0 ? "secondary" : "outline"}>
                            {submission.completedReviewerCount}/{submission.activeReviewerCount} complete
                          </Badge>
                          {submission.incompleteReviewerCount > 0 ? (
                            <span className="text-muted-foreground text-xs">
                              {submission.incompleteReviewerCount} incomplete
                            </span>
                          ) : null}
                          {submission.withdrawnReviewerCount > 0 ? (
                            <span className="text-muted-foreground text-xs">
                              {submission.withdrawnReviewerCount} withdrawn
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      {submission.criteria.map((criterion) => (
                        <TableCell key={criterion.id}>
                          <div className="flex min-w-24 flex-col gap-1 tabular-nums">
                            <span className="font-medium">{scoreLabel(criterion.average)}</span>
                            <span className="text-muted-foreground text-xs">
                              {criterion.scoreCount}/{submission.activeReviewerCount} scores
                            </span>
                            {criterion.missingScoreCount > 0 ? (
                              <span className="text-muted-foreground text-xs">
                                {criterion.missingScoreCount} missing
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                      ))}
                      <TableCell className="font-medium tabular-nums">
                        {scoreLabel(submission.weightedAverage)}
                      </TableCell>
                      <TableCell>
                        {submission.rank === null ? (
                          <Badge variant="outline">Unranked</Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="secondary">Rank {submission.rank}</Badge>
                            {submission.tied ? <Badge variant="outline">Tie</Badge> : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {workspace.selectedRoundId ? (
                          <SpeakerInvitationAction
                            eventSlug={event.slug}
                            roundId={workspace.selectedRoundId}
                            submission={submission}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {workspace.selectedRoundId ? (
                          <ProgressionAction
                            eventSlug={event.slug}
                            roundId={workspace.selectedRoundId}
                            submission={submission}
                            hasNextRound={workspace.workflow?.nextRound !== null}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="pr-(--card-spacing)">
                        {workspace.selectedRoundId ? (
                          <DecisionAction
                            eventSlug={event.slug}
                            roundId={workspace.selectedRoundId}
                            submission={submission}
                            hasNextRound={workspace.workflow?.nextRound !== null}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </main>
  );
}
