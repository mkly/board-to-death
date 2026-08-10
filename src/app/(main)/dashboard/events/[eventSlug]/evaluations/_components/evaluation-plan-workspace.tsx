import { Archive, ArrowDown, ArrowUp, CircleCheck, ClipboardCheck, LockKeyhole, Play, Plus, Save } from "lucide-react";

import { FormSelect } from "@/components/form-select";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { EvaluationPlanVersionStatus, EvaluationRoundStatus, ReviewerVisibility } from "@/generated/prisma/client";
import type { EvaluationPlanWithVersions } from "@/server/evaluations";

import { createPlan, createRound, moveRound, transitionRound, updateRound } from "../actions";

interface EvaluationPlanWorkspaceProps {
  readonly eventSlug: string;
  readonly plans: readonly EvaluationPlanWithVersions[];
}

const visibilityLabels: Record<ReviewerVisibility, string> = {
  IDENTIFIED: "Identified reviewers",
  BLIND: "Blind review",
  ANONYMIZED: "Anonymized review",
};

const statusLabels: Record<EvaluationRoundStatus, string> = {
  PLANNED: "Planned",
  OPEN: "Open",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

function statusVariant(status: EvaluationRoundStatus): "default" | "secondary" | "outline" {
  if (status === EvaluationRoundStatus.OPEN) return "default";
  if (status === EvaluationRoundStatus.PLANNED) return "secondary";
  return "outline";
}

function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function RoundFields({
  idPrefix,
  round,
  disabled = false,
}: {
  readonly idPrefix: string;
  readonly round?: EvaluationPlanWithVersions["versions"][number]["rounds"][number];
  readonly disabled?: boolean;
}) {
  return (
    <FieldGroup>
      <div className="grid gap-4 md:grid-cols-2">
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor={`${idPrefix}-title`}>Round title</FieldLabel>
          <Input
            id={`${idPrefix}-title`}
            name="title"
            defaultValue={round?.title}
            placeholder="Committee review"
            disabled={disabled}
            maxLength={120}
            required
          />
        </Field>
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor={`${idPrefix}-key`}>Stable key</FieldLabel>
          <Input
            id={`${idPrefix}-key`}
            name="key"
            defaultValue={round?.key}
            placeholder="committee-review"
            disabled={disabled}
            maxLength={80}
            required
          />
          <FieldDescription>Lowercase letters, numbers, and hyphens.</FieldDescription>
        </Field>
      </div>
      <Field data-disabled={disabled}>
        <FieldLabel htmlFor={`${idPrefix}-description`}>Description</FieldLabel>
        <Textarea
          id={`${idPrefix}-description`}
          name="description"
          defaultValue={round?.description ?? ""}
          disabled={disabled}
          rows={2}
          maxLength={500}
        />
      </Field>
      <Field data-disabled={disabled}>
        <FieldLabel htmlFor={`${idPrefix}-visibility`}>Reviewer visibility</FieldLabel>
        <FormSelect
          id={`${idPrefix}-visibility`}
          name="reviewerVisibility"
          defaultValue={round?.reviewerVisibility ?? ReviewerVisibility.BLIND}
          disabled={disabled}
          className="w-full"
          options={Object.values(ReviewerVisibility).map((visibility) => ({
            value: visibility,
            label: visibilityLabels[visibility],
          }))}
        />
        <FieldDescription>This value is snapshotted and locked when the round opens.</FieldDescription>
      </Field>
    </FieldGroup>
  );
}

function RoundCard({
  eventSlug,
  planVersionId,
  planVersionStatus,
  round,
  index,
  rounds,
}: {
  readonly eventSlug: string;
  readonly planVersionId: string;
  readonly planVersionStatus: EvaluationPlanVersionStatus;
  readonly round: EvaluationPlanWithVersions["versions"][number]["rounds"][number];
  readonly index: number;
  readonly rounds: EvaluationPlanWithVersions["versions"][number]["rounds"];
}) {
  const isPlanned = round.status === EvaluationRoundStatus.PLANNED;
  const editable = planVersionStatus === EvaluationPlanVersionStatus.DRAFT && isPlanned;
  const canMoveUp = editable && index > 0;
  const canMoveDown = editable && index < rounds.length - 1;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Round {index + 1}: {round.title}
          <Badge variant={statusVariant(round.status)}>{statusLabels[round.status]}</Badge>
        </CardTitle>
        <CardDescription>
          {round.visibilitySnapshot
            ? `${visibilityLabels[round.visibilitySnapshot]} locked when the round opened`
            : "Reviewer visibility remains editable until the round opens"}
        </CardDescription>
        <CardAction>
          <Badge variant="outline">
            {round._count.criteria} {round._count.criteria === 1 ? "criterion" : "criteria"}
          </Badge>
        </CardAction>
      </CardHeader>
      <form action={updateRound.bind(null, eventSlug, round.id)}>
        <CardContent className="flex flex-col gap-5">
          <RoundFields idPrefix={round.id} round={round} disabled={!editable} />
          <div className="flex flex-col gap-2">
            <p className="font-medium text-sm">Lifecycle history</p>
            <ol className="flex flex-col gap-1 text-muted-foreground text-xs">
              {round.transitions.map((transition) => (
                <li key={transition.id}>
                  {transition.fromStatus ? `${statusLabels[transition.fromStatus]} → ` : "Created as "}
                  {statusLabels[transition.toStatus]} · {formatTimestamp(transition.occurredAt)}
                </li>
              ))}
            </ol>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {editable ? (
            <>
              <Button type="submit" variant="outline" size="sm">
                <Save data-icon="inline-start" />
                Save round
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="icon-sm"
                aria-label={`Move ${round.title} up`}
                disabled={!canMoveUp}
                formAction={moveRound.bind(null, eventSlug, planVersionId, round.id, -1)}
                formNoValidate
              >
                <ArrowUp />
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="icon-sm"
                aria-label={`Move ${round.title} down`}
                disabled={!canMoveDown}
                formAction={moveRound.bind(null, eventSlug, planVersionId, round.id, 1)}
                formNoValidate
              >
                <ArrowDown />
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={round._count.criteria === 0}
                formAction={transitionRound.bind(null, eventSlug, round.id, EvaluationRoundStatus.OPEN)}
                formNoValidate
              >
                <Play data-icon="inline-start" />
                Open round
              </Button>
            </>
          ) : null}
          {round.status === EvaluationRoundStatus.OPEN ? (
            <Button
              type="submit"
              size="sm"
              formAction={transitionRound.bind(null, eventSlug, round.id, EvaluationRoundStatus.CLOSED)}
              formNoValidate
            >
              <CircleCheck data-icon="inline-start" />
              Close round
            </Button>
          ) : null}
          {round.status === EvaluationRoundStatus.CLOSED ? (
            <Button
              type="submit"
              variant="outline"
              size="sm"
              formAction={transitionRound.bind(null, eventSlug, round.id, EvaluationRoundStatus.ARCHIVED)}
              formNoValidate
            >
              <Archive data-icon="inline-start" />
              Archive round
            </Button>
          ) : null}
          {round.status === EvaluationRoundStatus.ARCHIVED ? (
            <span className="flex items-center gap-2 text-muted-foreground text-sm">
              <LockKeyhole aria-hidden="true" />
              Archived history is immutable.
            </span>
          ) : null}
        </CardFooter>
      </form>
    </Card>
  );
}

export function EvaluationPlanWorkspace({ eventSlug, plans }: EvaluationPlanWorkspaceProps) {
  return (
    <section className="flex flex-col gap-6" aria-labelledby="evaluation-lifecycle-heading">
      <div>
        <h2 id="evaluation-lifecycle-heading" className="font-semibold text-xl tracking-tight">
          Plan and round lifecycle
        </h2>
        <p className="text-muted-foreground text-sm">
          Create versioned evaluation plans, order their rounds, and preserve an auditable reviewer-visibility history.
        </p>
      </div>

      {plans.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheck />
            </EmptyMedia>
            <EmptyTitle>No evaluation plan yet</EmptyTitle>
            <EmptyDescription>Create a plan and its first draft version below.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle>{plan.key}</CardTitle>
              <CardDescription>Each version locks its rounds and rubric when evaluation begins.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-8">
              {plan.versions.map((version, versionIndex) => {
                const editable = version.status === EvaluationPlanVersionStatus.DRAFT;
                return (
                  <section key={version.id} className="flex flex-col gap-4" aria-labelledby={`version-${version.id}`}>
                    {versionIndex > 0 ? <Separator /> : null}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 id={`version-${version.id}`} className="font-medium">
                          {version.title}
                        </h3>
                        <p className="text-muted-foreground text-sm">
                          Version {version.versionNumber} · {version.status.toLowerCase()}
                        </p>
                      </div>
                      <Badge variant={editable ? "secondary" : "outline"}>{version.status.toLowerCase()}</Badge>
                    </div>
                    {version.rounds.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No rounds have been added to this version.</p>
                    ) : (
                      <div className="grid gap-4 xl:grid-cols-2">
                        {version.rounds.map((round, index) => (
                          <RoundCard
                            key={round.id}
                            eventSlug={eventSlug}
                            planVersionId={version.id}
                            planVersionStatus={version.status}
                            round={round}
                            index={index}
                            rounds={version.rounds}
                          />
                        ))}
                      </div>
                    )}
                    {editable ? (
                      <Card size="sm">
                        <form action={createRound.bind(null, eventSlug, version.id)}>
                          <CardHeader>
                            <CardTitle>Add planned round</CardTitle>
                            <CardDescription>
                              Configure every round and rubric before opening the first one.
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <RoundFields idPrefix={`new-${version.id}`} />
                          </CardContent>
                          <CardFooter className="mt-4">
                            <Button type="submit" size="sm">
                              <Plus data-icon="inline-start" />
                              Add round
                            </Button>
                          </CardFooter>
                        </form>
                      </Card>
                    ) : null}
                  </section>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}

      <Card>
        <form action={createPlan.bind(null, eventSlug)}>
          <CardHeader>
            <CardTitle>Create evaluation plan</CardTitle>
            <CardDescription>The first draft version is created with the plan.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="new-plan-title">Plan title</FieldLabel>
                  <Input id="new-plan-title" name="title" placeholder="2027 evaluation plan" maxLength={120} required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-plan-key">Stable key</FieldLabel>
                  <Input id="new-plan-key" name="key" placeholder="main-evaluation" maxLength={80} required />
                  <FieldDescription>Lowercase letters, numbers, and hyphens.</FieldDescription>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="new-plan-description">Description</FieldLabel>
                <Textarea id="new-plan-description" name="description" rows={2} maxLength={500} />
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="mt-4">
            <Button type="submit">
              <ClipboardCheck data-icon="inline-start" />
              Create plan
            </Button>
          </CardFooter>
        </form>
      </Card>
    </section>
  );
}
