import {
  Archive,
  ArrowDown,
  ArrowUp,
  CircleCheck,
  ClipboardCheck,
  LockKeyhole,
  Play,
  Plus,
  Save,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EvaluationRoundStatus, ReviewerVisibility } from "@/generated/prisma/client";
import type { EvaluationPlanWithRounds } from "@/server/evaluations";

import { createPlan, createRound, moveRound, transitionRound, updateRound } from "../actions";

interface EventOption {
  readonly id: string;
  readonly name: string;
}

interface EvaluationWorkspaceProps {
  readonly eventId: string;
  readonly eventOptions: readonly EventOption[];
  readonly plan: EvaluationPlanWithRounds | null;
  readonly notice?: string;
  readonly error?: string;
}

const visibilityLabels: Record<ReviewerVisibility, string> = {
  IDENTIFIED: "Identified reviewers",
  BLIND: "Blind review",
  ANONYMIZED: "Anonymized review",
};

const statusLabels: Record<EvaluationRoundStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

function statusVariant(status: EvaluationRoundStatus): "default" | "secondary" | "outline" {
  if (status === EvaluationRoundStatus.ACTIVE) return "default";
  if (status === EvaluationRoundStatus.DRAFT) return "secondary";
  return "outline";
}

function formatTimestamp(value: Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function RoundCard({
  eventId,
  planId,
  round,
  index,
  rounds,
}: {
  readonly eventId: string;
  readonly planId: string;
  readonly round: EvaluationPlanWithRounds["rounds"][number];
  readonly index: number;
  readonly rounds: EvaluationPlanWithRounds["rounds"];
}) {
  const isDraft = round.status === EvaluationRoundStatus.DRAFT;
  const canMoveUp = isDraft && index > 0 && rounds[index - 1]?.status === EvaluationRoundStatus.DRAFT;
  const canMoveDown = isDraft && index < rounds.length - 1 && rounds[index + 1]?.status === EvaluationRoundStatus.DRAFT;
  const lifecycleTimestamp = round.archivedAt ?? round.closedAt ?? round.activatedAt;

  return (
    <form action={updateRound.bind(null, eventId, round.id)}>
      <Card>
        <CardHeader>
          <CardTitle>
            Round {index + 1}: {round.name}
          </CardTitle>
          <CardDescription>
            {round.visibilitySnapshot
              ? `${visibilityLabels[round.visibilitySnapshot]} locked at activation`
              : "Visibility can be changed until activation"}
            {lifecycleTimestamp ? ` · ${formatTimestamp(lifecycleTimestamp)}` : null}
          </CardDescription>
          <CardAction>
            <Badge variant={statusVariant(round.status)}>{statusLabels[round.status]}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-disabled={!isDraft || undefined}>
              <FieldLabel htmlFor={`round-name-${round.id}`}>Round name</FieldLabel>
              <Input
                id={`round-name-${round.id}`}
                name="name"
                defaultValue={round.name}
                disabled={!isDraft}
                maxLength={120}
                required
              />
            </Field>
            <Field data-disabled={!isDraft || undefined}>
              <FieldLabel htmlFor={`round-visibility-${round.id}`}>Reviewer visibility</FieldLabel>
              <NativeSelect
                id={`round-visibility-${round.id}`}
                name="reviewerVisibility"
                defaultValue={round.reviewerVisibility}
                disabled={!isDraft}
                className="w-full"
              >
                {Object.values(ReviewerVisibility).map((visibility) => (
                  <NativeSelectOption key={visibility} value={visibility}>
                    {visibilityLabels[visibility]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>
                {round.reviewerVisibility === ReviewerVisibility.IDENTIFIED
                  ? "Reviewer identities are visible during this round."
                  : round.reviewerVisibility === ReviewerVisibility.BLIND
                    ? "Reviewers can see applicants, but applicants cannot see reviewer identities."
                    : "Applicant and reviewer identities are hidden from each other."}
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {isDraft ? (
            <>
              <Button type="submit" variant="outline">
                <Save data-icon="inline-start" />
                Save draft
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="icon"
                aria-label={`Move ${round.name} up`}
                disabled={!canMoveUp}
                formAction={moveRound.bind(null, eventId, planId, round.id, -1)}
                formNoValidate
              >
                <ArrowUp />
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="icon"
                aria-label={`Move ${round.name} down`}
                disabled={!canMoveDown}
                formAction={moveRound.bind(null, eventId, planId, round.id, 1)}
                formNoValidate
              >
                <ArrowDown />
              </Button>
              <Button
                type="submit"
                formAction={transitionRound.bind(null, eventId, round.id, EvaluationRoundStatus.ACTIVE)}
                formNoValidate
              >
                <Play data-icon="inline-start" />
                Activate
              </Button>
            </>
          ) : null}
          {round.status === EvaluationRoundStatus.ACTIVE ? (
            <Button
              type="submit"
              formAction={transitionRound.bind(null, eventId, round.id, EvaluationRoundStatus.CLOSED)}
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
              formAction={transitionRound.bind(null, eventId, round.id, EvaluationRoundStatus.ARCHIVED)}
              formNoValidate
            >
              <Archive data-icon="inline-start" />
              Archive
            </Button>
          ) : null}
          {round.status === EvaluationRoundStatus.ARCHIVED ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <LockKeyhole aria-hidden="true" />
              Lifecycle history is locked.
            </span>
          ) : null}
        </CardFooter>
      </Card>
    </form>
  );
}

export function EvaluationWorkspace({ eventId, eventOptions, plan, notice, error }: EvaluationWorkspaceProps) {
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">Program operations</p>
          <h1 className="text-2xl font-semibold tracking-tight">Evaluation plan</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Define ordered review rounds, reviewer visibility, and an auditable lifecycle for each event.
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <Field>
            <FieldLabel htmlFor="evaluation-event">Event</FieldLabel>
            <NativeSelect id="evaluation-event" name="event" defaultValue={eventId}>
              {eventOptions.map((event) => (
                <NativeSelectOption key={event.id} value={event.id}>
                  {event.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" variant="outline">
            View
          </Button>
        </form>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Evaluation plan not updated</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <CircleCheck />
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {!plan ? (
        <Card>
          <CardHeader>
            <CardTitle>Create an evaluation plan</CardTitle>
            <CardDescription>Each event has one plan containing its ordered review rounds.</CardDescription>
          </CardHeader>
          <form action={createPlan.bind(null, eventId)}>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="plan-name">Plan name</FieldLabel>
                  <Input id="plan-name" name="name" placeholder="CFP review" maxLength={120} required />
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
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-medium">{plan.name}</h2>
              <p className="text-sm text-muted-foreground">
                {plan.rounds.length === 0
                  ? "Add the first round to begin configuring review."
                  : `${plan.rounds.length} ${plan.rounds.length === 1 ? "round" : "rounds"} in lifecycle order.`}
              </p>
            </div>
            {plan.rounds.length === 0 ? (
              <Empty className="min-h-56 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ClipboardCheck />
                  </EmptyMedia>
                  <EmptyTitle>No evaluation rounds</EmptyTitle>
                  <EmptyDescription>Add a draft round below, then activate it when review begins.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {plan.rounds.map((round, index) => (
                  <RoundCard
                    key={round.id}
                    eventId={eventId}
                    planId={plan.id}
                    round={round}
                    index={index}
                    rounds={plan.rounds}
                  />
                ))}
              </div>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Add a draft round</CardTitle>
              <CardDescription>New rounds are appended after the existing lifecycle history.</CardDescription>
            </CardHeader>
            <form action={createRound.bind(null, eventId, plan.id)}>
              <CardContent>
                <FieldGroup className="md:grid md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="new-round-name">Round name</FieldLabel>
                    <Input id="new-round-name" name="name" placeholder="Committee review" maxLength={120} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-round-visibility">Reviewer visibility</FieldLabel>
                    <NativeSelect
                      id="new-round-visibility"
                      name="reviewerVisibility"
                      defaultValue={ReviewerVisibility.BLIND}
                      className="w-full"
                    >
                      {Object.values(ReviewerVisibility).map((visibility) => (
                        <NativeSelectOption key={visibility} value={visibility}>
                          {visibilityLabels[visibility]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="mt-4">
                <Button type="submit">
                  <Plus data-icon="inline-start" />
                  Add round
                </Button>
              </CardFooter>
            </form>
          </Card>
        </>
      )}
    </main>
  );
}
