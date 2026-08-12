"use client";

import { useActionState, useTransition } from "react";

import Link from "next/link";

import { ArrowRight, ClipboardList, ExternalLink, MessageSquareText, UserPlus, UsersRound } from "lucide-react";

import { FormSelect } from "@/components/form-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { actionResultToast, useActionToast } from "@/hooks/use-action-toast";
import type { DirectoryPersonSummary } from "@/server/contacts/repositories";
import type { SpeakerSourcingBoardStage, SpeakerSourcingRepository } from "@/server/speaker-sourcing/repositories";

import {
  addProspectNoteAction,
  assignProspectAction,
  configureStagesAction,
  createInterestFormAction,
  enrollProspectAction,
  moveProspectAction,
  type SpeakerSourcingActionState,
} from "../actions";

type InterestFormSummary = Awaited<ReturnType<SpeakerSourcingRepository["listInterestForms"]>>[number];

const INITIAL_STATE: SpeakerSourcingActionState = { status: "idle" };

interface SpeakerSourcingWorkspaceProps {
  readonly availablePeople: readonly DirectoryPersonSummary[];
  readonly event: { readonly id: string; readonly name: string; readonly slug: string };
  readonly forms: readonly InterestFormSummary[];
  readonly stages: readonly SpeakerSourcingBoardStage[];
}

function activityDescription(activity: SpeakerSourcingBoardStage["prospects"][number]["activities"][number]): string {
  if (activity.kind === "NOTE_ADDED") return activity.note ?? "Added an internal note.";
  if (activity.kind === "STAGE_CHANGED") {
    return `Moved from ${activity.fromStage?.name ?? "another stage"} to ${activity.toStage?.name ?? "another stage"}.`;
  }
  if (activity.kind === "ASSIGNED_TO_EVENT") return activity.note ?? "Assigned to the event.";
  return `Added from ${activity.actorLabel}.`;
}

function behaviorLabel(behavior: SpeakerSourcingBoardStage["behavior"]): string {
  if (behavior === "OPEN") return "Open";
  if (behavior === "NURTURE") return "Nurture";
  if (behavior === "WON") return "Won";
  return "Lost";
}

function ProspectCard({
  event,
  prospect,
  stages,
}: {
  readonly event: SpeakerSourcingWorkspaceProps["event"];
  readonly prospect: SpeakerSourcingBoardStage["prospects"][number];
  readonly stages: readonly SpeakerSourcingBoardStage[];
}) {
  const [moveState, moveAction, movePending] = useActionState(
    moveProspectAction.bind(null, event.slug, prospect.id),
    INITIAL_STATE,
  );
  useActionToast(moveState);
  const [noteState, noteAction, notePending] = useActionState(
    addProspectNoteAction.bind(null, event.slug, prospect.id),
    INITIAL_STATE,
  );
  useActionToast(noteState);
  const [assigning, startAssignTransition] = useTransition();

  const fullName = `${prospect.person.givenName} ${prospect.person.familyName}`;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{fullName}</CardTitle>
        <CardDescription>{prospect.person.email}</CardDescription>
        <Badge variant="outline">{prospect.sourceLabel}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Organization</dt>
            <dd>{prospect.person.organization ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{prospect.person.jobTitle ?? "—"}</dd>
          </div>
        </dl>

        <form action={moveAction}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`prospect-stage-${prospect.id}`}>Move card</FieldLabel>
              <FormSelect
                defaultValue={prospect.stageId}
                id={`prospect-stage-${prospect.id}`}
                name="stageId"
                options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
              />
              <Button disabled={movePending} size="sm" type="submit" variant="outline">
                {movePending ? <Spinner data-icon="inline-start" /> : <ArrowRight data-icon="inline-start" />}
                {movePending ? "Moving…" : "Move"}
              </Button>
            </Field>
          </FieldGroup>
        </form>

        <form action={noteAction}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`prospect-note-${prospect.id}`}>Internal note</FieldLabel>
              <Textarea id={`prospect-note-${prospect.id}`} maxLength={2000} name="note" required />
              <Button disabled={notePending} size="sm" type="submit" variant="outline">
                {notePending ? <Spinner data-icon="inline-start" /> : <MessageSquareText data-icon="inline-start" />}
                {notePending ? "Adding…" : "Add note"}
              </Button>
            </Field>
          </FieldGroup>
        </form>

        <Separator />
        <div className="flex flex-col gap-2">
          <p className="font-medium text-sm">Activity</p>
          <ol className="flex flex-col gap-2">
            {prospect.activities.slice(0, 5).map((activity) => (
              <li className="text-muted-foreground text-xs" key={activity.id}>
                <Badge
                  className="me-1 align-middle"
                  variant={activity.actor === "AUTOMATION" ? "outline" : "secondary"}
                >
                  {activity.actor === "AUTOMATION" ? "Automated" : "Team member"}
                </Badge>
                <span className="text-foreground">{activity.actorLabel}</span> · {activityDescription(activity)}
                <time className="block" dateTime={activity.createdAt.toISOString()}>
                  {activity.createdAt.toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
      <CardFooter>
        {prospect.assignedEvent ? (
          <Badge variant="secondary">Assigned to {prospect.assignedEvent.name}</Badge>
        ) : (
          <Button
            disabled={assigning}
            size="sm"
            type="button"
            onClick={() =>
              startAssignTransition(async () => {
                actionResultToast(await assignProspectAction(event.slug, prospect.id));
              })
            }
          >
            {assigning ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" />}
            {assigning ? "Assigning…" : `Assign to ${event.name}`}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export function SpeakerSourcingWorkspace({ availablePeople, event, forms, stages }: SpeakerSourcingWorkspaceProps) {
  const [interestFormState, interestFormAction, interestFormPending] = useActionState(
    createInterestFormAction.bind(null, event.slug),
    INITIAL_STATE,
  );
  useActionToast(interestFormState);
  const [enrollState, enrollAction, enrollPending] = useActionState(
    enrollProspectAction.bind(null, event.slug),
    INITIAL_STATE,
  );
  useActionToast(enrollState);
  const [stagesState, stagesAction, stagesPending] = useActionState(
    configureStagesAction.bind(null, event.slug),
    INITIAL_STATE,
  );
  useActionToast(stagesState);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-semibold text-2xl tracking-tight">Speaker sourcing</h1>
        <p className="text-muted-foreground text-sm">
          Capture public interest, nurture prospects, and add booked speakers to this event.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Publish an interest form</CardTitle>
            <CardDescription>
              Each response creates or reuses a directory person and adds one prospect card.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={interestFormAction}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="interest-form-title">Title</FieldLabel>
                  <Input id="interest-form-title" name="title" placeholder="Speak at Tabletop Summit" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="interest-form-description">Description</FieldLabel>
                  <Textarea id="interest-form-description" maxLength={1000} name="description" />
                </Field>
                <Button className="self-start" disabled={interestFormPending} type="submit">
                  {interestFormPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ExternalLink data-icon="inline-start" />
                  )}
                  {interestFormPending ? "Publishing…" : "Publish form"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
          {forms.length > 0 ? (
            <CardFooter className="flex flex-col items-stretch gap-2">
              {forms.map((form) => (
                <div className="flex items-center justify-between gap-3 text-sm" key={form.id}>
                  <div>
                    <p className="font-medium">{form.title}</p>
                    <p className="text-muted-foreground">{form._count.prospects} responses</p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/speaker-interest/${form.publicId}`} target="_blank">
                      Open
                      <ExternalLink data-icon="inline-end" />
                    </Link>
                  </Button>
                </div>
              ))}
            </CardFooter>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Enroll from the directory</CardTitle>
            <CardDescription>
              Add a known person manually without creating a duplicate directory record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {availablePeople.length === 0 ? (
              <Empty className="min-h-40 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <UsersRound />
                  </EmptyMedia>
                  <EmptyTitle>No available directory people</EmptyTitle>
                  <EmptyDescription>New interest-form responses will appear here automatically.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <form action={enrollAction}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="manual-prospect-person">Directory person</FieldLabel>
                    <FormSelect
                      id="manual-prospect-person"
                      name="personId"
                      placeholder="Select a person"
                      required
                      options={availablePeople.map((person) => ({
                        value: person.id,
                        label: `${person.givenName} ${person.familyName} · ${person.email}`,
                      }))}
                    />
                    <Button className="self-start" disabled={enrollPending} type="submit">
                      {enrollPending ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" />}
                      {enrollPending ? "Enrolling…" : "Enroll prospect"}
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline stages</CardTitle>
          <CardDescription>
            Rename and reorder the four system stages. Their open, nurture, won, and lost behaviors stay attached.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={stagesAction}>
            <FieldGroup>
              {stages.map((stage, index) => (
                <Field key={stage.id} orientation="responsive">
                  <input name="stageId" type="hidden" value={stage.id} />
                  <FieldLabel htmlFor={`stage-name-${stage.id}`}>{behaviorLabel(stage.behavior)}</FieldLabel>
                  <Input defaultValue={stage.name} id={`stage-name-${stage.id}`} name="stageName" required />
                  <FormSelect
                    aria-label={`${stage.name} position`}
                    defaultValue={String(index)}
                    name="stagePosition"
                    options={stages.map((_positionStage, position) => ({
                      value: String(position),
                      label: `Position ${position + 1}`,
                    }))}
                  />
                </Field>
              ))}
              <FieldDescription>Choose a unique position for each stage.</FieldDescription>
              <Button className="self-start" disabled={stagesPending} type="submit" variant="outline">
                {stagesPending ? <Spinner data-icon="inline-start" /> : null}
                {stagesPending ? "Saving…" : "Save stage settings"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="pipeline-heading" className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold text-xl" id="pipeline-heading">
            Prospect pipeline
          </h2>
          <p className="text-muted-foreground text-sm">Move cards as conversations progress.</p>
        </div>
        <div className="grid auto-cols-[minmax(18rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-3">
          {stages.map((stage) => (
            <Card className="min-w-0" key={stage.id}>
              <CardHeader>
                <CardTitle>{stage.name}</CardTitle>
                <CardDescription>{behaviorLabel(stage.behavior)} behavior</CardDescription>
                <Badge variant="secondary">{stage.prospects.length}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {stage.prospects.length === 0 ? (
                  <Empty className="min-h-36 border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <ClipboardList />
                      </EmptyMedia>
                      <EmptyTitle>No prospects</EmptyTitle>
                      <EmptyDescription>Move or enroll a person into this stage.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  stage.prospects.map((prospect) => (
                    <ProspectCard event={event} key={prospect.id} prospect={prospect} stages={stages} />
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
