"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { ArrowDown, ArrowUp, ClipboardCheck, LockKeyhole, Plus } from "lucide-react";

import { DerivedIdentifierFields } from "@/components/derived-identifier-fields";
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
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { actionResultToast, useActionToast } from "@/hooks/use-action-toast";
import type { EvaluationCriterionRecord, EvaluationRubricPlan } from "@/server/evaluations/rubrics";

import {
  addDefaultCriteria,
  createCriterion,
  type EvaluationActionState,
  moveCriterion,
  updateCriterion,
} from "../actions";

interface EvaluationRubricWorkspaceProps {
  readonly event: { readonly slug: string };
  readonly plans: readonly EvaluationRubricPlan[];
}

const INITIAL_STATE: EvaluationActionState = { status: "idle" };

function CriterionFields({
  criterion,
  idPrefix,
  disabled = false,
}: {
  readonly criterion?: EvaluationCriterionRecord;
  readonly idPrefix: string;
  readonly disabled?: boolean;
}) {
  return (
    <FieldGroup>
      <div className="grid gap-4 md:grid-cols-2">
        <DerivedIdentifierFields
          disabled={disabled}
          identifierDescription="Lowercase letters, numbers, and hyphens."
          identifierId={`${idPrefix}-key`}
          identifierInitialValue={criterion?.key}
          identifierLabel="Stable key"
          identifierName="key"
          identifierPlaceholder="program-fit"
          sourceId={`${idPrefix}-label`}
          sourceInitialValue={criterion?.label}
          sourceLabel="Label"
          sourceName="label"
        />
      </div>
      <Field data-disabled={disabled}>
        <FieldLabel htmlFor={`${idPrefix}-description`}>Reviewer guidance</FieldLabel>
        <Textarea
          id={`${idPrefix}-description`}
          name="description"
          defaultValue={criterion?.description ?? ""}
          disabled={disabled}
          rows={2}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor={`${idPrefix}-minimum`}>Minimum</FieldLabel>
          <Input
            id={`${idPrefix}-minimum`}
            name="minimum"
            type="number"
            step="any"
            defaultValue={criterion?.minimum ?? 1}
            disabled={disabled}
            required
          />
        </Field>
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor={`${idPrefix}-maximum`}>Maximum</FieldLabel>
          <Input
            id={`${idPrefix}-maximum`}
            name="maximum"
            type="number"
            step="any"
            defaultValue={criterion?.maximum ?? 5}
            disabled={disabled}
            required
          />
        </Field>
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor={`${idPrefix}-weight`}>Weight</FieldLabel>
          <Input
            id={`${idPrefix}-weight`}
            name="weight"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={criterion?.weight ?? 1}
            disabled={disabled}
            required
          />
        </Field>
      </div>
      <Field orientation="horizontal" data-disabled={disabled}>
        <Checkbox
          id={`${idPrefix}-required`}
          name="required"
          defaultChecked={criterion?.required ?? true}
          disabled={disabled}
        />
        <FieldContent>
          <FieldLabel htmlFor={`${idPrefix}-required`}>Required criterion</FieldLabel>
          <FieldDescription>Reviewers must score this criterion before submitting an evaluation.</FieldDescription>
        </FieldContent>
      </Field>
    </FieldGroup>
  );
}

function CriterionCard({
  criterion,
  eventSlug,
  roundId,
  index,
  count,
  editable,
  reorderable,
  totalWeight,
}: {
  readonly criterion: EvaluationCriterionRecord;
  readonly eventSlug: string;
  readonly roundId: string;
  readonly index: number;
  readonly count: number;
  readonly editable: boolean;
  readonly reorderable: boolean;
  readonly totalWeight: number;
}) {
  const [state, saveAction, saving] = useActionState(
    updateCriterion.bind(null, eventSlug, criterion.id),
    INITIAL_STATE,
  );
  useActionToast(state);
  const [moving, startTransition] = useTransition();
  const busy = saving || moving;
  const move = (offset: -1 | 1) => {
    startTransition(async () => {
      actionResultToast(await moveCriterion(eventSlug, roundId, criterion.id, offset));
    });
  };
  const mutable = editable && !criterion.used;
  const percentage = totalWeight > 0 ? Math.round((criterion.weight / totalWeight) * 100) : 0;
  let lockMessage = "Changes apply only to this draft plan version.";
  if (!editable) lockMessage = "This plan version is historical and cannot be edited.";
  else if (criterion.used) lockMessage = "This criterion has evaluation results and is locked.";
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {criterion.label}
          {criterion.required ? <Badge variant="secondary">Required</Badge> : null}
          <Badge variant="outline">{percentage}% normalized</Badge>
        </CardTitle>
        <CardDescription>
          Scores {criterion.minimum}–{criterion.maximum} · Weight {criterion.weight}
        </CardDescription>
        {reorderable ? (
          <CardAction className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={index === 0 || busy}
              aria-label={`Move ${criterion.label} up`}
              onClick={() => move(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={index === count - 1 || busy}
              aria-label={`Move ${criterion.label} down`}
              onClick={() => move(1)}
            >
              <ArrowDown />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <form noValidate action={saveAction}>
        <CardContent>
          <CriterionFields criterion={criterion} idPrefix={criterion.id} disabled={!mutable} />
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p className="text-muted-foreground text-xs">{lockMessage}</p>
          {mutable ? (
            <Button type="submit" size="sm" disabled={busy}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              Save criterion
            </Button>
          ) : (
            <LockKeyhole aria-hidden="true" />
          )}
        </CardFooter>
      </form>
    </Card>
  );
}

function AddDefaultRubricButton({ eventSlug, roundId }: { readonly eventSlug: string; readonly roundId: string }) {
  const [pending, startTransition] = useTransition();
  const add = () => {
    startTransition(async () => {
      actionResultToast(await addDefaultCriteria(eventSlug, roundId));
    });
  };
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={add}>
      {pending ? <Spinner data-icon="inline-start" /> : <ClipboardCheck data-icon="inline-start" />}
      Add default rubric
    </Button>
  );
}

function AddCriterionForm({ eventSlug, roundId }: { readonly eventSlug: string; readonly roundId: string }) {
  const [state, action, pending] = useActionState(createCriterion.bind(null, eventSlug, roundId), INITIAL_STATE);
  const [formKey, setFormKey] = useState(0);
  useActionToast(state);

  useEffect(() => {
    if (state.status === "success") {
      setFormKey((current) => current + 1);
    }
  }, [state]);

  return (
    <Card size="sm">
      <form noValidate action={action} key={formKey}>
        <CardHeader>
          <CardTitle>Add criterion</CardTitle>
          <CardDescription>Create a scoring dimension for this draft round.</CardDescription>
        </CardHeader>
        <CardContent>
          <CriterionFields idPrefix={`new-${roundId}`} />
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            Add criterion
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function EvaluationRubricWorkspace({ event, plans }: EvaluationRubricWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div>
          <h2 className="font-semibold text-xl tracking-tight">Scoring rubrics</h2>
          <p className="text-muted-foreground text-sm">
            Configure version-safe scoring criteria, guidance, bounds, required state, and normalized weights.
          </p>
        </div>
      </header>

      {plans.length === 0 ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheck />
            </EmptyMedia>
            <EmptyTitle>No evaluation plan yet</EmptyTitle>
            <EmptyDescription>Create a draft evaluation plan and round before configuring its rubric.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        plans.map((plan) => (
          <section key={plan.id} className="flex flex-col gap-4" aria-labelledby={`plan-${plan.id}`}>
            <div>
              <h2 id={`plan-${plan.id}`} className="font-semibold text-lg">
                {plan.key}
              </h2>
              <p className="text-muted-foreground text-sm">
                Each plan version preserves the scoring rules used for its evaluations.
              </p>
            </div>
            {plan.versions.map((version) => {
              const editable = version.status === "DRAFT";
              return (
                <Card key={version.id}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {version.title}
                      <Badge variant={editable ? "secondary" : "outline"}>Version {version.versionNumber}</Badge>
                      <Badge variant={editable ? "default" : "outline"}>{version.status.toLowerCase()}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {editable
                        ? "Draft criteria can be edited until this version is activated."
                        : "This version is locked to preserve historical scores."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-6">
                    {version.rounds.map((round, roundIndex) => {
                      const totalWeight = round.criteria.reduce((total, criterion) => total + criterion.weight, 0);
                      return (
                        <section key={round.id} className="flex flex-col gap-4" aria-labelledby={`round-${round.id}`}>
                          {roundIndex > 0 ? <Separator /> : null}
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 id={`round-${round.id}`} className="font-medium">
                                {round.title}
                              </h3>
                              <p className="text-muted-foreground text-sm">
                                {round.criteria.length} {round.criteria.length === 1 ? "criterion" : "criteria"} · Total
                                weight {totalWeight}
                              </p>
                            </div>
                            {editable && round.criteria.length === 0 ? (
                              <AddDefaultRubricButton eventSlug={event.slug} roundId={round.id} />
                            ) : null}
                          </div>
                          <div className="grid gap-4 xl:grid-cols-2">
                            {round.criteria.map((criterion, index) => (
                              <CriterionCard
                                key={criterion.id}
                                criterion={criterion}
                                eventSlug={event.slug}
                                roundId={round.id}
                                index={index}
                                count={round.criteria.length}
                                editable={editable}
                                reorderable={editable && !round.criteria.some(({ used }) => used)}
                                totalWeight={totalWeight}
                              />
                            ))}
                          </div>
                          {editable ? <AddCriterionForm eventSlug={event.slug} roundId={round.id} /> : null}
                        </section>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
