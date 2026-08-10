"use client";

import { useActionState, useMemo } from "react";

import { AlertCircle, CheckCircle2, FileSpreadsheet, Save } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { applySpeakerCsv, previewSpeakerCsv, type SpeakerCsvImportState } from "../actions";

const INITIAL_STATE: SpeakerCsvImportState = { status: "idle" };

function outcomeBadge(outcome: "created" | "skipped" | "rejected") {
  if (outcome === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (outcome === "skipped") return <Badge variant="secondary">Already in roster</Badge>;
  return <Badge>Create</Badge>;
}

export function SpeakerCsvImport({ eventSlug }: { readonly eventSlug: string }) {
  const [previewState, previewAction, previewPending] = useActionState(previewSpeakerCsv, INITIAL_STATE);
  const [applyState, applyAction, applyPending] = useActionState(applySpeakerCsv, INITIAL_STATE);
  const acceptedPayload = useMemo(
    () => previewState.rows?.flatMap((row) => (row.payload ? [row.payload] : [])) ?? [],
    [previewState.rows],
  );
  const visibleState = applyState.status === "idle" ? previewState : applyState;
  const showPreview = previewState.status === "preview" && applyState.status === "idle";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import speakers</CardTitle>
        <CardDescription>
          Upload a CSV, review each row, then add only new valid speakers. Existing roster emails are skipped.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form action={previewAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <input name="eventSlug" type="hidden" value={eventSlug} />
          <Field className="flex-1">
            <FieldLabel htmlFor="speaker-csv-file">Speaker CSV</FieldLabel>
            <Input accept=".csv,text/csv" id="speaker-csv-file" name="csvFile" required type="file" />
            <FieldDescription>
              Use name, email, title, company, and bio columns. Maximum 500 rows and 1 MB.
            </FieldDescription>
          </Field>
          <Button disabled={previewPending} type="submit">
            {previewPending ? <Spinner data-icon="inline-start" /> : <FileSpreadsheet data-icon="inline-start" />}
            {previewPending ? "Reading…" : "Preview CSV"}
          </Button>
        </form>

        {visibleState.status === "error" ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Import could not continue</AlertTitle>
            <AlertDescription>{visibleState.message}</AlertDescription>
          </Alert>
        ) : null}
        {visibleState.status === "success" ? (
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Import complete</AlertTitle>
            <AlertDescription>{visibleState.message}</AlertDescription>
          </Alert>
        ) : null}
        {showPreview ? (
          <Alert>
            <FileSpreadsheet />
            <AlertTitle>Preview ready</AlertTitle>
            <AlertDescription>{previewState.message}</AlertDescription>
          </Alert>
        ) : null}
        {visibleState.counts ? (
          <output aria-live="polite" className="flex flex-wrap gap-2">
            <Badge>{visibleState.counts.created} create</Badge>
            <Badge variant="secondary">{visibleState.counts.skipped} skipped</Badge>
            <Badge variant="destructive">{visibleState.counts.rejected} rejected</Badge>
          </output>
        ) : null}
        {visibleState.rows ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Speaker</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Validation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleState.rows.map((row) => (
                <TableRow key={row.rowNumber}>
                  <TableCell>{row.rowNumber}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.email || "—"}</TableCell>
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
        ) : null}
      </CardContent>
      {showPreview ? (
        <CardFooter className="justify-end">
          <form action={applyAction}>
            <input name="eventSlug" type="hidden" value={eventSlug} />
            <input name="previewPayload" type="hidden" value={JSON.stringify(acceptedPayload)} />
            <Button disabled={applyPending || acceptedPayload.length === 0} type="submit">
              {applyPending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              {applyPending ? "Importing…" : `Import ${acceptedPayload.length} new speakers`}
            </Button>
          </form>
        </CardFooter>
      ) : null}
    </Card>
  );
}
