"use client";

import { useMemo, useState, useTransition } from "react";

import { AlertCircle, CheckCircle2, FileSearch, FileSpreadsheet, Save } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import {
  commitSpreadsheetAction,
  inspectSpreadsheetAction,
  previewSpreadsheetAction,
  type SpreadsheetActionState,
} from "../actions";

interface RecentImport {
  readonly id: string;
  readonly entityType: ImportEntityType;
  readonly fileName: string;
  readonly actorId: string;
  readonly createdAt: string;
  readonly created: number;
  readonly updated: number;
}

interface SpreadsheetImportWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly recentImports: readonly RecentImport[];
}

const INITIAL_STATE: SpreadsheetActionState = { status: "idle" };
const SKIP_COLUMN = "__skip__";
const IMPORT_ENTITY = { CONTACT: "CONTACT", PROGRAM_SESSION: "PROGRAM_SESSION" } as const;
type ImportEntityType = (typeof IMPORT_ENTITY)[keyof typeof IMPORT_ENTITY];

function normalized(value: string): string {
  return value.toLocaleLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function requestForm(
  eventSlug: string,
  entityType: ImportEntityType,
  file: File,
  mapping?: Readonly<Record<string, string>>,
): FormData {
  const formData = new FormData();
  formData.set("eventSlug", eventSlug);
  formData.set("entityType", entityType);
  formData.set("spreadsheet", file);
  if (mapping) formData.set("mapping", JSON.stringify(mapping));
  return formData;
}

function outcomeBadge(outcome: "created" | "updated" | "rejected") {
  if (outcome === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (outcome === "updated") return <Badge variant="secondary">Update</Badge>;
  return <Badge>Create</Badge>;
}

function PreviewTable({ state }: { readonly state: SpreadsheetActionState }) {
  if (!state.preview) return null;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Row</TableHead>
          <TableHead>Identity</TableHead>
          <TableHead>Result</TableHead>
          <TableHead>Validation</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.preview.rows.map((row) => (
          <TableRow key={row.rowNumber}>
            <TableCell>{row.rowNumber}</TableCell>
            <TableCell className="font-medium">{row.identity}</TableCell>
            <TableCell>{outcomeBadge(row.outcome)}</TableCell>
            <TableCell>
              {row.errors.length === 0 ? (
                <span className="text-muted-foreground">Ready</span>
              ) : (
                <ul className="flex max-w-xl list-disc flex-col gap-1 pl-4 text-destructive">
                  {row.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function SpreadsheetImportWorkspace({ event, recentImports }: SpreadsheetImportWorkspaceProps) {
  const [entityType, setEntityType] = useState<ImportEntityType>(IMPORT_ENTITY.CONTACT);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<SpreadsheetActionState>(INITIAL_STATE);
  const [mapping, setMapping] = useState<Readonly<Record<string, string>>>({});
  const [pending, startTransition] = useTransition();
  const selectedTargets = useMemo(
    () => new Set(Object.values(mapping).filter((value) => value !== SKIP_COLUMN)),
    [mapping],
  );

  function run(action: (formData: FormData) => Promise<SpreadsheetActionState>, includeMapping: boolean) {
    if (!file) {
      setState({ status: "error", message: "Choose a CSV or XLSX file." });
      return;
    }
    startTransition(async () => {
      const result = await action(requestForm(event.slug, entityType, file, includeMapping ? mapping : undefined));
      // Preview and commit answer without the column list, so carry the one
      // inspect returned. Dropping it would hide the mapping controls exactly
      // when a rejected preview needs them remapped.
      setState((current) => ({
        ...result,
        headers: result.headers ?? current.headers,
        fields: result.fields ?? current.fields,
      }));
      if (result.status === "ready" && result.headers && result.fields) {
        const suggestions = Object.fromEntries(
          result.headers.map((header) => {
            const match = result.fields?.find(
              (field) =>
                normalized(field.label.replace(/\s*\(custom.*\)$/, "")) === normalized(header) ||
                normalized(field.key) === normalized(header),
            );
            return [header, match?.key ?? SKIP_COLUMN];
          }),
        );
        setMapping(suggestions);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">Spreadsheet imports</h1>
        <p className="text-muted-foreground text-sm">
          Map CSV or XLSX columns to contact or session fields, validate every row, then commit one atomic import.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Prepare an import</CardTitle>
          <CardDescription>
            Contacts match existing records by email. Sessions match active records by title. Multi-select custom values
            use a pipe separator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="import-entity-type">Record type</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    setEntityType(value as ImportEntityType);
                    setState(INITIAL_STATE);
                    setMapping({});
                  }}
                  value={entityType}
                >
                  <SelectTrigger id="import-entity-type">
                    <SelectValue>{entityType === IMPORT_ENTITY.CONTACT ? "Contacts" : "Sessions"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={IMPORT_ENTITY.CONTACT}>Contacts</SelectItem>
                      <SelectItem value={IMPORT_ENTITY.PROGRAM_SESSION}>Sessions</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="import-file">Spreadsheet</FieldLabel>
                <Input
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  id="import-file"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setState(INITIAL_STATE);
                    setMapping({});
                  }}
                  type="file"
                />
                <FieldDescription>CSV or XLSX, up to 500 rows and 1 MB.</FieldDescription>
              </Field>
            </div>

            {state.status === "error" ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Import could not continue</AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}
            {state.status === "success" ? (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>Import committed</AlertTitle>
                <AlertDescription>
                  {state.message} Audit reference: {state.importId}
                </AlertDescription>
              </Alert>
            ) : null}
            {state.status === "ready" || state.status === "preview" ? (
              <Alert>
                <FileSpreadsheet />
                <AlertTitle>{state.status === "ready" ? "Map spreadsheet columns" : "Preview complete"}</AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            {state.headers && state.fields ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.headers.map((header) => (
                  <Field key={header}>
                    <FieldLabel htmlFor={`mapping-${normalized(header)}`}>{header}</FieldLabel>
                    <Select
                      onValueChange={(value) => {
                        setMapping((current) => ({ ...current, [header]: value }));
                        setState((current) => ({ ...current, status: "ready", preview: undefined }));
                      }}
                      value={mapping[header] ?? SKIP_COLUMN}
                    >
                      <SelectTrigger id={`mapping-${normalized(header)}`}>
                        <SelectValue placeholder="Skip this column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={SKIP_COLUMN}>Skip this column</SelectItem>
                          {state.fields?.map((field) => (
                            <SelectItem
                              disabled={selectedTargets.has(field.key) && mapping[header] !== field.key}
                              key={field.key}
                              value={field.key}
                            >
                              {field.label}
                              {field.required ? " *" : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                ))}
              </div>
            ) : null}

            {state.preview ? (
              <output aria-live="polite" className="flex flex-wrap gap-2">
                <Badge>{state.preview.created} create</Badge>
                <Badge variant="secondary">{state.preview.updated} update</Badge>
                <Badge variant="destructive">{state.preview.rejected} rejected</Badge>
              </output>
            ) : null}
            <PreviewTable state={state} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          {state.status === "idle" || state.status === "error" || state.status === "success" ? (
            <Button disabled={pending || !file} onClick={() => run(inspectSpreadsheetAction, false)} type="button">
              {pending ? <Spinner data-icon="inline-start" /> : <FileSearch data-icon="inline-start" />}
              {pending ? "Reading…" : "Inspect file"}
            </Button>
          ) : null}
          {state.status === "ready" ? (
            <Button disabled={pending} onClick={() => run(previewSpreadsheetAction, true)} type="button">
              {pending ? <Spinner data-icon="inline-start" /> : <FileSearch data-icon="inline-start" />}
              {pending ? "Validating…" : "Preview changes"}
            </Button>
          ) : null}
          {state.status === "preview" ? (
            <>
              <Button
                disabled={pending}
                onClick={() => run(previewSpreadsheetAction, true)}
                type="button"
                variant="outline"
              >
                Revalidate
              </Button>
              <Button
                disabled={pending || (state.preview?.rejected ?? 1) > 0}
                onClick={() => run(commitSpreadsheetAction, true)}
                type="button"
              >
                {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                {pending ? "Committing…" : "Commit every row"}
              </Button>
            </>
          ) : null}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent imports</CardTitle>
          <CardDescription>Audited spreadsheet changes for this event.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentImports.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No imports yet</EmptyTitle>
                <EmptyDescription>
                  Committed spreadsheet imports will appear here with their audit details.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Changes</TableHead>
                  <TableHead>Imported by</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentImports.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.fileName}</TableCell>
                    <TableCell>{entry.entityType === IMPORT_ENTITY.CONTACT ? "Contacts" : "Sessions"}</TableCell>
                    <TableCell>
                      {entry.created} created · {entry.updated} updated
                    </TableCell>
                    <TableCell>{entry.actorId}</TableCell>
                    <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
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
