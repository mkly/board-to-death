"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";

import { Filter, History, PencilLine } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { applyBulkEdit, type BulkEditActionState } from "../actions";

type EntityType = "CONTACT" | "SESSION" | "GROUP";

interface RecordRow {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly values: string;
  readonly customFields: readonly {
    readonly definitionId: string;
    readonly label: string;
    readonly value: unknown;
  }[];
}

interface AuditRow {
  readonly id: string;
  readonly entityType: EntityType;
  readonly field: string;
  readonly requestedCount: number;
  readonly succeededCount: number;
  readonly performedBy: string;
  readonly createdAt: string;
}

interface BulkEditWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly contacts: readonly RecordRow[];
  readonly sessions: readonly RecordRow[];
  readonly groups: readonly RecordRow[];
  readonly customFieldDefinitions: readonly {
    readonly id: string;
    readonly label: string;
    readonly entityType: EntityType;
  }[];
  readonly customFieldFilter: {
    readonly definitionId: string;
    readonly entityType: EntityType;
    readonly query: string;
  } | null;
  readonly tracks: readonly { readonly id: string; readonly name: string }[];
  readonly audits: readonly AuditRow[];
}

const ENTITY_LABELS: Record<EntityType, string> = {
  CONTACT: "Contacts",
  SESSION: "Sessions",
  GROUP: "Groups",
};

const FIELD_OPTIONS = {
  CONTACT: [
    { value: "organization", label: "Organization" },
    { value: "jobTitle", label: "Job title" },
    { value: "phone", label: "Phone" },
  ],
  SESSION: [
    { value: "description", label: "Description" },
    { value: "durationMinutes", label: "Duration (minutes)" },
    { value: "trackId", label: "Track" },
  ],
  GROUP: [{ value: "name", label: "Name" }],
} as const;

function auditEntityLabel(entityType: EntityType): string {
  return ENTITY_LABELS[entityType].slice(0, -1);
}

function customFieldValueLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").join(", ");
  if (value && typeof value === "object" && "fileName" in value && typeof value.fileName === "string") {
    return value.fileName;
  }
  return "Not set";
}

interface RecordTableProps {
  readonly entityType: EntityType;
  readonly records: readonly RecordRow[];
  readonly selected: ReadonlySet<string>;
  readonly onSelectionChange: (selection: Set<string>) => void;
}

function RecordTable({ entityType, records, selected, onSelectionChange }: RecordTableProps) {
  const allSelected = records.length > 0 && selected.size === records.length;
  let selectAllState: boolean | "indeterminate" = false;
  if (allSelected) selectAllState = true;
  else if (selected.size > 0) selectAllState = "indeterminate";

  const toggleRecord = (recordId: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(recordId);
    else next.delete(recordId);
    onSelectionChange(next);
  };

  if (records.length === 0) {
    return (
      <Empty className="min-h-56">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PencilLine />
          </EmptyMedia>
          <EmptyTitle>No {ENTITY_LABELS[entityType].toLowerCase()} to edit</EmptyTitle>
          <EmptyDescription>Add records to this event before starting a bulk edit.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label={`Select all ${ENTITY_LABELS[entityType].toLowerCase()}`}
              checked={selectAllState}
              onCheckedChange={(checked) =>
                onSelectionChange(checked === true ? new Set(records.map(({ id }) => id)) : new Set())
              }
            />
          </TableHead>
          <TableHead>Record</TableHead>
          <TableHead>Current details</TableHead>
          <TableHead>Custom fields</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record) => (
          <TableRow key={record.id} data-state={selected.has(record.id) ? "selected" : undefined}>
            <TableCell>
              <Checkbox
                aria-label={`Select ${record.name}`}
                checked={selected.has(record.id)}
                onCheckedChange={(checked) => toggleRecord(record.id, checked === true)}
              />
            </TableCell>
            <TableCell>
              <div className="flex min-w-48 flex-col gap-1 whitespace-normal">
                <span className="font-medium">{record.name}</span>
                <span className="text-muted-foreground text-xs">{record.detail}</span>
              </div>
            </TableCell>
            <TableCell>{record.values}</TableCell>
            <TableCell>
              {record.customFields.length === 0 ? (
                <span className="text-muted-foreground">None configured</span>
              ) : (
                <dl className="flex min-w-44 flex-col gap-2 whitespace-normal">
                  {record.customFields.map((field) => (
                    <div key={field.definitionId}>
                      <dt className="text-muted-foreground text-xs">{field.label}</dt>
                      <dd>{customFieldValueLabel(field.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function BulkEditWorkspace({
  event,
  contacts,
  sessions,
  groups,
  customFieldDefinitions,
  customFieldFilter,
  tracks,
  audits,
}: BulkEditWorkspaceProps) {
  const initialEntityType = customFieldFilter?.entityType ?? "CONTACT";
  const recordsByType = useMemo(
    () => ({ CONTACT: contacts, SESSION: sessions, GROUP: groups }),
    [contacts, sessions, groups],
  );
  const [entityType, setEntityType] = useState<EntityType>(initialEntityType);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [field, setField] = useState<string>(FIELD_OPTIONS[initialEntityType][0].value);
  const [value, setValue] = useState("");
  const [result, setResult] = useState<BulkEditActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const records = recordsByType[entityType];
  const fieldLabel = FIELD_OPTIONS[entityType].find((option) => option.value === field)?.label ?? field;

  const changeEntityType = (next: string) => {
    const type = next as EntityType;
    setEntityType(type);
    setSelected(new Set());
    setField(FIELD_OPTIONS[type][0].value);
    setValue("");
    setResult(null);
  };

  const confirmEdit = () => {
    const submittedValue = entityType === "SESSION" && field === "trackId" && value === "unassigned" ? "" : value;
    startTransition(async () => {
      const actionResult = await applyBulkEdit(event.slug, {
        entityType,
        recordIds: [...selected],
        field,
        value: submittedValue,
      });
      setResult(actionResult);
      if (actionResult.status === "success") setSelected(new Set());
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">Bulk edit records</h1>
        <p className="text-muted-foreground text-sm">
          Select event records, choose one field, and review the count before applying the same value to each record.
        </p>
      </header>

      {result ? (
        <Alert variant={result.status === "error" ? "destructive" : "default"}>
          <AlertTitle>{result.status === "partial" ? "Some records were not updated" : "Bulk edit result"}</AlertTitle>
          <AlertDescription>
            <p>{result.message}</p>
            {result.failures?.length ? (
              <ul className="mt-2 list-disc pl-5">
                {result.failures.map((failure) => (
                  <li key={failure.recordId}>
                    {records.find(({ id }) => id === failure.recordId)?.name ?? failure.recordId}: {failure.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card className="min-w-0 self-start">
          <CardHeader>
            <CardTitle>Select records</CardTitle>
            <CardDescription>Only active records owned by this event are available.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {customFieldDefinitions.length > 0 ? (
              <form method="get">
                <FieldGroup className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
                  <Field>
                    <FieldLabel htmlFor="record-custom-field-filter">Custom field</FieldLabel>
                    <NativeSelect
                      className="w-full"
                      defaultValue={customFieldFilter?.definitionId ?? ""}
                      id="record-custom-field-filter"
                      name="customField"
                      required
                    >
                      <NativeSelectOption disabled value="">
                        Choose a custom field
                      </NativeSelectOption>
                      {(Object.keys(ENTITY_LABELS) as EntityType[]).map((type) => {
                        const definitions = customFieldDefinitions.filter(({ entityType }) => entityType === type);
                        return definitions.length > 0 ? (
                          <NativeSelectOptGroup key={type} label={ENTITY_LABELS[type]}>
                            {definitions.map((definition) => (
                              <NativeSelectOption key={definition.id} value={definition.id}>
                                {definition.label}
                              </NativeSelectOption>
                            ))}
                          </NativeSelectOptGroup>
                        ) : null;
                      })}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="record-custom-field-value">Value contains</FieldLabel>
                    <Input
                      defaultValue={customFieldFilter?.query ?? ""}
                      id="record-custom-field-value"
                      name="customValue"
                      placeholder="Search saved values"
                      required
                      type="search"
                    />
                  </Field>
                  <Field orientation="horizontal" className="self-end">
                    <Button type="submit" variant="outline">
                      <Filter data-icon="inline-start" />
                      Apply filter
                    </Button>
                    <Button asChild type="button" variant="ghost">
                      <Link href={`/dashboard/events/${encodeURIComponent(event.slug)}/records`}>Clear</Link>
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
            ) : null}
            {customFieldFilter ? (
              <p className="text-muted-foreground text-sm">
                Showing {ENTITY_LABELS[customFieldFilter.entityType].toLowerCase()} whose selected custom field contains
                “{customFieldFilter.query}”.
              </p>
            ) : null}
            <ToggleGroup
              type="single"
              value={entityType}
              onValueChange={(next) => {
                if (next) changeEntityType(next);
              }}
              variant="outline"
              aria-label="Record type"
            >
              {(Object.keys(ENTITY_LABELS) as EntityType[]).map((type) => (
                <ToggleGroupItem key={type} value={type} aria-label={ENTITY_LABELS[type]}>
                  {ENTITY_LABELS[type]} ({recordsByType[type].length})
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <RecordTable
              entityType={entityType}
              records={records}
              selected={selected}
              onSelectionChange={setSelected}
            />
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Set field value</CardTitle>
            <CardDescription>{selected.size} selected records will be offered this change.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="bulk-edit-field">Field</FieldLabel>
                <Select
                  value={field}
                  onValueChange={(next) => {
                    setField(next);
                    setValue("");
                  }}
                >
                  <SelectTrigger id="bulk-edit-field" className="w-full">
                    <SelectValue placeholder="Choose a field" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {FIELD_OPTIONS[entityType].map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="bulk-edit-value">New value</FieldLabel>
                {entityType === "SESSION" && field === "trackId" ? (
                  <Select value={value || "unassigned"} onValueChange={setValue}>
                    <SelectTrigger id="bulk-edit-value" className="w-full">
                      <SelectValue placeholder="Choose a track" />
                    </SelectTrigger>
                    <SelectContent position="popper">
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
                ) : (
                  <Input
                    id="bulk-edit-value"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    type={entityType === "SESSION" && field === "durationMinutes" ? "number" : "text"}
                    min={entityType === "SESSION" && field === "durationMinutes" ? 1 : undefined}
                    max={entityType === "SESSION" && field === "durationMinutes" ? 1_440 : undefined}
                  />
                )}
                <FieldDescription>
                  Blank values clear optional fields. Group names and session durations require a value.
                </FieldDescription>
              </Field>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" disabled={selected.size === 0 || pending}>
                    {pending ? <Spinner data-icon="inline-start" /> : <PencilLine data-icon="inline-start" />}
                    Review bulk edit
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Update {selected.size} records?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {fieldLabel} will be set for every selected {ENTITY_LABELS[entityType].toLowerCase().slice(0, -1)}
                      . Records that cannot accept the change will be reported separately.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmEdit}>Apply to {selected.size} records</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent bulk edits</CardTitle>
          <CardDescription>The latest event-scoped operations and their outcomes.</CardDescription>
        </CardHeader>
        <CardContent>
          {audits.length === 0 ? (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <History />
                </EmptyMedia>
                <EmptyTitle>No bulk edits yet</EmptyTitle>
                <EmptyDescription>Completed operations appear here for audit.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Record type</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Administrator</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audits.map((audit) => (
                  <TableRow key={audit.id}>
                    <TableCell>{new Date(audit.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{auditEntityLabel(audit.entityType)}</TableCell>
                    <TableCell>{audit.field}</TableCell>
                    <TableCell>
                      <Badge variant={audit.succeededCount === audit.requestedCount ? "secondary" : "outline"}>
                        {audit.succeededCount} of {audit.requestedCount}
                      </Badge>
                    </TableCell>
                    <TableCell>{audit.performedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
