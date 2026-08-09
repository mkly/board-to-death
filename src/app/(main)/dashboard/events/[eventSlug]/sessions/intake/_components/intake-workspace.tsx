"use client";

import { useActionState, useMemo, useState } from "react";

import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Save } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CfpFormDefinition, CfpQuestion } from "@/lib/cfp";

import {
  applyAdminIntakeCsv,
  type CsvIntakeState,
  createAdminIntake,
  type ManualIntakeState,
  previewAdminIntakeCsv,
} from "../actions";
import { ParticipantOrderPicker } from "./participant-order-picker";

interface IntakeFormOption {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly versionNumber: number;
  readonly definition: CfpFormDefinition;
}

interface IntakeWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly forms: readonly IntakeFormOption[];
  readonly speakers: readonly { readonly id: string; readonly name: string; readonly email: string }[];
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
  readonly categories: readonly { readonly id: string; readonly label: string }[];
}

const INITIAL_MANUAL_STATE: ManualIntakeState = { status: "idle" };
const INITIAL_CSV_STATE: CsvIntakeState = { status: "idle" };
const SUBMISSION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "WAITLISTED",
  "ACCEPTED",
  "REJECTED",
  "CONFIRMED",
] as const;

function fieldError(state: ManualIntakeState, name: string): string | undefined {
  return state.errors?.[name]?.[0];
}

function QuestionLabel({ question }: { readonly question: CfpQuestion }) {
  return (
    <>
      {question.label}
      {question.required ? <span className="text-destructive"> *</span> : null}
    </>
  );
}

function QuestionField({ question, error }: { readonly question: CfpQuestion; readonly error?: string }) {
  const id = `answer.${question.id}`;
  if (question.type === "checkbox") {
    return (
      <Field data-invalid={Boolean(error) || undefined} orientation="horizontal">
        <Checkbox aria-invalid={Boolean(error) || undefined} id={id} name={id} />
        <FieldContent>
          <FieldLabel htmlFor={id}>
            <QuestionLabel question={question} />
          </FieldLabel>
          {question.description ? <FieldDescription>{question.description}</FieldDescription> : null}
          <FieldError>{error}</FieldError>
        </FieldContent>
      </Field>
    );
  }
  let control = (
    <Input
      aria-invalid={Boolean(error) || undefined}
      id={id}
      max={question.constraints?.max}
      maxLength={question.constraints?.maxLength}
      min={question.constraints?.min}
      minLength={question.constraints?.minLength}
      name={id}
      pattern={question.constraints?.pattern}
      required={question.required}
      type={question.type === "short_text" ? "text" : question.type}
    />
  );
  if (question.type === "long_text") {
    control = (
      <Textarea
        aria-invalid={Boolean(error) || undefined}
        id={id}
        maxLength={question.constraints?.maxLength}
        minLength={question.constraints?.minLength}
        name={id}
        required={question.required}
      />
    );
  } else if (question.type === "select" || question.type === "multi_select") {
    control = (
      <NativeSelect
        aria-invalid={Boolean(error) || undefined}
        id={id}
        multiple={question.type === "multi_select"}
        name={id}
        required={question.required}
      >
        {question.type === "select" ? <NativeSelectOption value="">Select an option</NativeSelectOption> : null}
        {(question.constraints?.options ?? []).map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }
  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={id}>
        <QuestionLabel question={question} />
      </FieldLabel>
      {question.description ? <FieldDescription>{question.description}</FieldDescription> : null}
      {control}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function ManualIntake({ forms, speakers, tracks, categories, event }: IntakeWorkspaceProps) {
  const [state, formAction, pending] = useActionState(createAdminIntake, INITIAL_MANUAL_STATE);
  const [kind, setKind] = useState<"abstract" | "guaranteed_session">("abstract");
  const [formVersionId, setFormVersionId] = useState(forms[0]?.id ?? "");
  const selectedForm = forms.find(({ id }) => id === formVersionId);

  return (
    <form action={formAction}>
      <input name="eventSlug" type="hidden" value={event.slug} />
      <input name="kind" type="hidden" value={kind} />
      <Card>
        <CardHeader>
          <CardTitle>Manual intake</CardTitle>
          <CardDescription>
            Create an abstract or guaranteed session with event-scoped references and a durable client identifier.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {state.status === "success" ? (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>Record created</AlertTitle>
                <AlertDescription>
                  {state.message} Reference: {state.recordId}
                </AlertDescription>
              </Alert>
            ) : null}
            {state.status === "error" && state.message ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Intake could not be saved</AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel id="intake-kind-label">Record type</FieldLabel>
              <ToggleGroup
                aria-labelledby="intake-kind-label"
                onValueChange={(next) => {
                  if (next === "abstract" || next === "guaranteed_session") setKind(next);
                }}
                type="single"
                value={kind}
              >
                <ToggleGroupItem value="abstract">Abstract</ToggleGroupItem>
                <ToggleGroupItem value="guaranteed_session">Guaranteed session</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field data-invalid={Boolean(fieldError(state, "clientIdentifier")) || undefined}>
              <FieldLabel htmlFor="intake-client-identifier">Client identifier</FieldLabel>
              <Input
                aria-invalid={Boolean(fieldError(state, "clientIdentifier")) || undefined}
                id="intake-client-identifier"
                name="clientIdentifier"
                placeholder="partner-feed-1042"
                required
              />
              <FieldDescription>Stable within this event; CSV retries use it to detect updates.</FieldDescription>
              <FieldError>{fieldError(state, "clientIdentifier")}</FieldError>
            </Field>

            {kind === "abstract" ? (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field data-invalid={Boolean(fieldError(state, "formVersionId")) || undefined}>
                    <FieldLabel htmlFor="intake-form">CFP form</FieldLabel>
                    <Select name="formVersionId" onValueChange={setFormVersionId} value={formVersionId}>
                      <SelectTrigger id="intake-form">
                        <SelectValue placeholder="Choose a form" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {forms.map((form) => (
                            <SelectItem key={form.id} value={form.id}>
                              {form.title} · v{form.versionNumber}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError>{fieldError(state, "formVersionId")}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(fieldError(state, "submissionStatus")) || undefined}>
                    <FieldLabel htmlFor="intake-status">Status</FieldLabel>
                    <Select defaultValue="SUBMITTED" name="submissionStatus">
                      <SelectTrigger id="intake-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {SUBMISSION_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status.replaceAll("_", " ").toLowerCase()}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError>{fieldError(state, "submissionStatus")}</FieldError>
                  </Field>
                </div>
                {selectedForm?.definition.sections.map((section) => (
                  <FieldSet key={section.id}>
                    <FieldLegend>{section.title}</FieldLegend>
                    {section.description ? <FieldDescription>{section.description}</FieldDescription> : null}
                    <FieldGroup>
                      {section.questions.map((question) => (
                        <QuestionField error={fieldError(state, question.id)} key={question.id} question={question} />
                      ))}
                    </FieldGroup>
                  </FieldSet>
                ))}
                {categories.length > 0 ? (
                  <FieldSet>
                    <FieldLegend variant="label">Categories</FieldLegend>
                    <FieldDescription>
                      Optional event categories; routed categories are added automatically.
                    </FieldDescription>
                    <FieldGroup className="gap-3">
                      {categories.map((category) => (
                        <Field key={category.id} orientation="horizontal">
                          <Checkbox id={`intake-category-${category.id}`} name="categoryIds" value={category.id} />
                          <FieldLabel className="font-normal" htmlFor={`intake-category-${category.id}`}>
                            {category.label}
                          </FieldLabel>
                        </Field>
                      ))}
                    </FieldGroup>
                  </FieldSet>
                ) : null}
              </>
            ) : (
              <>
                <Field data-invalid={Boolean(fieldError(state, "title")) || undefined}>
                  <FieldLabel htmlFor="intake-session-title">Title</FieldLabel>
                  <Input
                    aria-invalid={Boolean(fieldError(state, "title")) || undefined}
                    id="intake-session-title"
                    name="title"
                    required
                  />
                  <FieldError>{fieldError(state, "title")}</FieldError>
                </Field>
                <Field data-invalid={Boolean(fieldError(state, "description")) || undefined}>
                  <FieldLabel htmlFor="intake-session-description">Description</FieldLabel>
                  <Textarea id="intake-session-description" name="description" />
                  <FieldError>{fieldError(state, "description")}</FieldError>
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field data-invalid={Boolean(fieldError(state, "durationMinutes")) || undefined}>
                    <FieldLabel htmlFor="intake-session-duration">Duration (minutes)</FieldLabel>
                    <Input
                      defaultValue={45}
                      id="intake-session-duration"
                      max={1440}
                      min={1}
                      name="durationMinutes"
                      type="number"
                    />
                    <FieldError>{fieldError(state, "durationMinutes")}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(fieldError(state, "trackId")) || undefined}>
                    <FieldLabel htmlFor="intake-session-track">Track</FieldLabel>
                    <Select defaultValue="unassigned" name="trackId">
                      <SelectTrigger id="intake-session-track">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="unassigned">No track</SelectItem>
                          {tracks.map((track) => (
                            <SelectItem key={track.id} value={track.id}>
                              {track.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError>{fieldError(state, "trackId")}</FieldError>
                  </Field>
                </div>
              </>
            )}
            <ParticipantOrderPicker speakers={speakers} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button disabled={pending || (kind === "abstract" && forms.length === 0)} type="submit">
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {pending ? "Creating…" : "Create record"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function outcomeBadge(outcome: "created" | "updated" | "unchanged" | "rejected") {
  if (outcome === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (outcome === "created") return <Badge>Create</Badge>;
  if (outcome === "updated") return <Badge variant="secondary">Update</Badge>;
  return <Badge variant="outline">Unchanged</Badge>;
}

function PreviewTable({ state }: { readonly state: CsvIntakeState }) {
  if (!state.rows) return null;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Row</TableHead>
          <TableHead>Client identifier</TableHead>
          <TableHead>Record</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.rows.map((row) => (
          <TableRow key={`${row.rowNumber}-${row.clientIdentifier}`}>
            <TableCell>{row.rowNumber}</TableCell>
            <TableCell className="font-medium">{row.clientIdentifier || "—"}</TableCell>
            <TableCell>
              {row.title}
              <span className="block text-muted-foreground text-xs">{row.kind}</span>
            </TableCell>
            <TableCell>
              {outcomeBadge(row.outcome)}
              {row.errors.map((error) => (
                <p className="mt-1 text-destructive text-xs" key={error}>
                  {error}
                </p>
              ))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CsvIntake({ event }: Pick<IntakeWorkspaceProps, "event">) {
  const [previewState, previewAction, previewPending] = useActionState(previewAdminIntakeCsv, INITIAL_CSV_STATE);
  const [applyState, applyAction, applyPending] = useActionState(applyAdminIntakeCsv, INITIAL_CSV_STATE);
  const acceptedPayload = useMemo(
    () => previewState.rows?.flatMap((row) => (row.payload ? [row.payload] : [])) ?? [],
    [previewState.rows],
  );
  const visibleState = applyState.status === "idle" ? previewState : applyState;

  return (
    <Card>
      <CardHeader>
        <CardTitle>CSV intake</CardTitle>
        <CardDescription>
          Preview every row as create, update, unchanged, or rejected. Only accepted rows are sent to apply.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Alert>
          <FileSpreadsheet />
          <AlertTitle>Documented format</AlertTitle>
          <AlertDescription>
            Use pipe-separated participant emails and category keys. Abstract rows require form_key, status, and an
            answers_json object. Guaranteed sessions require title and duration_minutes; track is optional.
          </AlertDescription>
        </Alert>
        <form action={previewAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <input name="eventSlug" type="hidden" value={event.slug} />
          <Field className="flex-1">
            <FieldLabel htmlFor="intake-csv-file">CSV file</FieldLabel>
            <Input accept=".csv,text/csv" id="intake-csv-file" name="csvFile" required type="file" />
            <FieldDescription>Maximum 500 rows and 1 MB.</FieldDescription>
          </Field>
          <div className="flex gap-2">
            <Button asChild type="button" variant="outline">
              <a href={`/dashboard/events/${event.slug}/sessions/intake/template.csv`}>
                <Download data-icon="inline-start" />
                Template
              </a>
            </Button>
            <Button disabled={previewPending} type="submit">
              {previewPending ? <Spinner data-icon="inline-start" /> : <FileSpreadsheet data-icon="inline-start" />}
              {previewPending ? "Reading…" : "Preview CSV"}
            </Button>
          </div>
        </form>
        {visibleState.status === "error" && visibleState.message ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>CSV intake failed</AlertTitle>
            <AlertDescription>{visibleState.message}</AlertDescription>
          </Alert>
        ) : null}
        {visibleState.status === "success" && visibleState.message ? (
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Import finished</AlertTitle>
            <AlertDescription>{visibleState.message}</AlertDescription>
          </Alert>
        ) : null}
        {previewState.status === "preview" ? (
          <output aria-live="polite" className="flex flex-wrap gap-2">
            <Badge>{previewState.counts?.created ?? 0} create</Badge>
            <Badge variant="secondary">{previewState.counts?.updated ?? 0} update</Badge>
            <Badge variant="outline">{previewState.counts?.unchanged ?? 0} unchanged</Badge>
            <Badge variant="destructive">{previewState.counts?.rejected ?? 0} rejected</Badge>
          </output>
        ) : null}
        <PreviewTable state={visibleState} />
      </CardContent>
      {previewState.status === "preview" ? (
        <CardFooter className="justify-end">
          <form action={applyAction}>
            <input name="eventSlug" type="hidden" value={event.slug} />
            <input name="previewPayload" type="hidden" value={JSON.stringify(acceptedPayload)} />
            <Button disabled={applyPending || acceptedPayload.length === 0} type="submit">
              {applyPending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              {applyPending ? "Applying…" : `Apply ${acceptedPayload.length} accepted rows`}
            </Button>
          </form>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function IntakeWorkspace(props: IntakeWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{props.event.name}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">Abstract and session intake</h1>
        <p className="text-muted-foreground text-sm">
          Add event records individually or preview a repeatable CSV import before applying any changes.
        </p>
      </header>
      <Tabs defaultValue="manual">
        <TabsList>
          <TabsTrigger value="manual">Manual entry</TabsTrigger>
          <TabsTrigger value="csv">CSV import</TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
          <ManualIntake {...props} />
        </TabsContent>
        <TabsContent value="csv">
          <CsvIntake event={props.event} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
