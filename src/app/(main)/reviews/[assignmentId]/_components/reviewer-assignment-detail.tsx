"use client";

import { useActionState } from "react";

import Link from "next/link";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  Lock,
  Save,
  Send,
  ShieldAlert,
  UserRound,
} from "lucide-react";

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { EvaluationRecommendation } from "@/generated/prisma/client";
import type { ReviewerAssignmentDetail } from "@/server/evaluations/reviewer-workspace";

import { declareEvaluationConflict, type EvaluationFormState, saveEvaluationDraft, submitEvaluation } from "../actions";

interface ReviewerAssignmentDetailProps {
  readonly assignment: ReviewerAssignmentDetail;
}

const visibilityDetails = {
  IDENTIFIED: {
    label: "Identified review",
    description: "Applicant identity is visible for this round.",
    icon: Eye,
  },
  BLIND: {
    label: "Blind review",
    description: "Applicant and speaker identity fields are hidden for this round.",
    icon: EyeOff,
  },
  ANONYMIZED: {
    label: "Anonymized review",
    description: "Applicant identity is replaced with a stable submission reference.",
    icon: Fingerprint,
  },
} as const;

const recommendationLabels: Record<EvaluationRecommendation, string> = {
  ACCEPT: "Accept",
  WAITLIST: "Waitlist",
  REJECT: "Reject",
};

const recommendations = Object.keys(recommendationLabels) as EvaluationRecommendation[];

const INITIAL_STATE: EvaluationFormState = { status: "idle" };

function latestState(first: EvaluationFormState, second: EvaluationFormState): EvaluationFormState {
  if (first.status === "idle") return second;
  if (second.status === "idle") return first;
  return (second.at ?? 0) >= (first.at ?? 0) ? second : first;
}

function FormAlert({ state }: { readonly state: EvaluationFormState }) {
  if (state.status === "idle") return null;
  return (
    <Alert variant={state.status === "error" ? "destructive" : "default"}>
      {state.status === "success" ? <Check /> : null}
      <AlertTitle>{state.status === "error" ? "Evaluation not saved" : "Evaluation saved"}</AlertTitle>
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

export function ReviewerAssignmentDetailView({ assignment }: ReviewerAssignmentDetailProps) {
  const visibility = visibilityDetails[assignment.visibility];
  const VisibilityIcon = visibility.icon;
  const isFinal = assignment.evaluation.status === "FINAL";

  const [draftState, draftAction, draftPending] = useActionState(saveEvaluationDraft, INITIAL_STATE);
  const [submitState, submitAction, submitPending] = useActionState(submitEvaluation, INITIAL_STATE);
  const [recusalState, recusalAction, recusalPending] = useActionState(declareEvaluationConflict, INITIAL_STATE);
  const recusalFormId = `declare-conflict-${assignment.id}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/reviews">
            <ArrowLeft data-icon="inline-start" />
            All reviews
          </Link>
        </Button>
      </div>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-sm">
              {assignment.event.name} · {assignment.round.title}
            </p>
            <h1 className="font-semibold text-2xl tracking-tight">{assignment.submission.reference}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {isFinal ? (
              <Badge variant="default">
                <Lock data-icon="inline-start" />
                Finalized
              </Badge>
            ) : null}
            <Badge variant="outline">
              <VisibilityIcon data-icon="inline-start" />
              {visibility.label}
            </Badge>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">{visibility.description}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Proposal</CardTitle>
              <CardDescription>
                {assignment.formTitle} · {assignment.submission.kind.toLowerCase().replaceAll("_", " ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {assignment.submission.answers.length === 0 ? (
                <Empty className="min-h-48 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <EyeOff />
                    </EmptyMedia>
                    <EmptyTitle>No reviewable answers</EmptyTitle>
                    <EmptyDescription>
                      This proposal has no non-identity answers available in the configured review view.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                assignment.submission.answers.map((answer, index) => (
                  <div key={answer.questionId} className="flex flex-col gap-2">
                    {index > 0 ? <Separator /> : null}
                    <h2 className="font-medium text-sm">{answer.label}</h2>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {answer.value || "No answer provided"}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {assignment.submission.applicants.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Applicants</CardTitle>
                <CardDescription>Identity is visible because this round is configured as identified.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {assignment.submission.applicants.map((applicant) => (
                  <div key={applicant.email} className="flex items-center gap-3 rounded-lg border p-3">
                    <UserRound aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{applicant.name}</p>
                      <p className="truncate text-muted-foreground text-xs">{applicant.email}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4" aria-label="Review rubric">
          <div>
            <h2 className="font-semibold text-lg">Rubric guidance</h2>
            <p className="text-muted-foreground text-sm">{assignment.round.planTitle}</p>
          </div>

          <FormAlert state={latestState(draftState, submitState)} />
          {recusalState.status === "error" ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertTitle>Conflict not declared</AlertTitle>
              <AlertDescription>{recusalState.message}</AlertDescription>
            </Alert>
          ) : null}

          {isFinal ? (
            <>
              <Alert>
                <Lock />
                <AlertTitle>This evaluation is finalized</AlertTitle>
                <AlertDescription>
                  It is immutable until an administrator reopens it for further edits.
                </AlertDescription>
              </Alert>
              {assignment.criteria.map((criterion) => (
                <Card key={criterion.id} size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {criterion.label}
                      {criterion.required ? <Badge variant="secondary">Required</Badge> : null}
                    </CardTitle>
                    <CardDescription>{criterion.description ?? "No additional guidance."}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-xs">
                      Score {criterion.minimum}–{criterion.maximum} · Weight {criterion.weight}
                    </p>
                    {criterion.score === null ? (
                      <Badge variant="outline">Not scored</Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 aria-hidden="true" />
                        <span className="font-medium text-sm">Score {criterion.score}</span>
                      </div>
                    )}
                    {criterion.note ? <p className="text-muted-foreground text-sm">{criterion.note}</p> : null}
                  </CardContent>
                </Card>
              ))}
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Overall feedback</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="text-sm">{assignment.evaluation.overallNote ?? "No overall feedback provided."}</p>
                  <p className="text-muted-foreground text-xs">
                    Recommendation:{" "}
                    {assignment.evaluation.recommendation
                      ? recommendationLabels[assignment.evaluation.recommendation]
                      : "None"}
                  </p>
                </CardContent>
              </Card>
            </>
          ) : (
            <form key={assignment.evaluation.version} className="flex flex-col gap-4">
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <input type="hidden" name="expectedVersion" value={assignment.evaluation.version} />

              <FieldGroup>
                {assignment.criteria.map((criterion) => (
                  <Field key={criterion.id}>
                    <input type="hidden" name="criterionId" value={criterion.id} />
                    <FieldLabel htmlFor={`score-${criterion.id}`} className="flex items-center gap-2">
                      {criterion.label}
                      {criterion.required ? <Badge variant="secondary">Required</Badge> : null}
                    </FieldLabel>
                    <FieldDescription>{criterion.description ?? "No additional guidance."}</FieldDescription>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`score-${criterion.id}`}
                        name={`score:${criterion.id}`}
                        type="number"
                        inputMode="decimal"
                        min={criterion.minimum}
                        max={criterion.maximum}
                        step="any"
                        defaultValue={criterion.score ?? ""}
                        placeholder={`${criterion.minimum}–${criterion.maximum}`}
                        className="w-28"
                      />
                      <span className="text-muted-foreground text-xs">
                        Range {criterion.minimum}–{criterion.maximum} · Weight {criterion.weight}
                      </span>
                    </div>
                    <Textarea
                      name={`note:${criterion.id}`}
                      defaultValue={criterion.note ?? ""}
                      placeholder="Criterion comments (optional)"
                      rows={2}
                    />
                  </Field>
                ))}

                <Field>
                  <FieldLabel htmlFor="overallNote">Overall feedback</FieldLabel>
                  <Textarea
                    id="overallNote"
                    name="overallNote"
                    defaultValue={assignment.evaluation.overallNote ?? ""}
                    rows={4}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="recommendation">Recommendation</FieldLabel>
                  <NativeSelect
                    id="recommendation"
                    name="recommendation"
                    defaultValue={assignment.evaluation.recommendation ?? ""}
                    className="w-full"
                  >
                    <NativeSelectOption value="">Not yet decided</NativeSelectOption>
                    {recommendations.map((recommendation) => (
                      <NativeSelectOption key={recommendation} value={recommendation}>
                        {recommendationLabels[recommendation]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldDescription>Required to submit the final evaluation.</FieldDescription>
                </Field>
              </FieldGroup>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  formAction={draftAction}
                  variant="outline"
                  disabled={draftPending || submitPending}
                >
                  {draftPending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                  Save draft
                </Button>
                <Button type="submit" formAction={submitAction} disabled={draftPending || submitPending}>
                  {submitPending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                  Submit final
                </Button>
              </div>
            </form>
          )}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Conflict of interest</CardTitle>
              <CardDescription>
                Declare a conflict if you cannot evaluate this proposal impartially. It will leave your active queue and
                the organizer can reassign it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form id={recusalFormId} action={recusalAction}>
                <input type="hidden" name="assignmentId" value={assignment.id} />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" disabled={recusalPending}>
                      {recusalPending ? <Spinner data-icon="inline-start" /> : <ShieldAlert data-icon="inline-start" />}
                      {recusalPending ? "Declaring" : "Declare conflict"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Declare a conflict of interest?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This review will be removed from your active queue. Any draft or submitted scores will no longer
                        count toward the proposal&apos;s aggregate results.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction type="submit" form={recusalFormId} variant="destructive">
                        Declare conflict
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
