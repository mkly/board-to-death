import Link from "next/link";

import { Archive, ArchiveRestore, ArrowLeft, Download, FileUp } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FileRequestVersion } from "@/generated/prisma/client";
import type { AssignmentWithContext, FileRequestWithVersion } from "@/server/files/repositories";
import type { StoredFileRecord } from "@/server/files/request-files";

import {
  archiveFileRequestAction,
  assignFileRequestAction,
  restoreFileRequestAction,
  withdrawAssignmentAction,
} from "../actions";
import { FileRequestFormSheet } from "./file-request-form-sheet";
import { contentTypeLabel, formatBytes, TARGET_KIND_LABELS } from "./file-request-options";

export interface AssignableTarget {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface AssignmentFiles {
  readonly assignmentId: string;
  readonly files: readonly StoredFileRecord[];
}

const STATUS_VARIANTS = {
  PENDING: "outline",
  FULFILLED: "secondary",
  WITHDRAWN: "destructive",
} as const;

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "—";
}

function dueWording(dueOffsetDays: number | null): string {
  if (dueOffsetDays === null) return "No due date";
  if (dueOffsetDays === 0) return "On the event start date";
  return `${dueOffsetDays} days before the event starts`;
}

export function FileRequestDetail({
  event,
  request,
  version,
  assignments,
  files,
  targets,
  notice,
  error,
}: {
  readonly event: { readonly name: string; readonly slug: string };
  readonly request: FileRequestWithVersion;
  readonly version: FileRequestVersion;
  readonly assignments: readonly AssignmentWithContext[];
  readonly files: readonly AssignmentFiles[];
  readonly targets: readonly AssignableTarget[];
  readonly notice?: string;
  readonly error?: string;
}) {
  const indexHref = `/dashboard/events/${encodeURIComponent(event.slug)}/file-requests`;
  const filesByAssignment = new Map(files.map((entry) => [entry.assignmentId, entry.files]));
  const collected = files.reduce((total, entry) => total + entry.files.filter((file) => !file.supersededAt).length, 0);
  const archived = request.archivedAt !== null;

  return (
    <div className="flex flex-col gap-4">
      <Button asChild className="w-fit px-0" variant="link">
        <Link href={indexHref}>
          <ArrowLeft data-icon="inline-start" />
          File requests
        </Link>
      </Button>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-medium text-2xl leading-tight tracking-tight sm:text-3xl sm:leading-none">
            {version.title}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{TARGET_KIND_LABELS[request.targetKind]}</Badge>
            <Badge variant="outline">version {version.versionNumber}</Badge>
            {archived ? <Badge variant="outline">Archived</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {collected > 0 ? (
            <Button asChild variant="outline">
              <a href={`${indexHref}/export`}>
                <Download data-icon="inline-start" />
                Export all files
              </a>
            </Button>
          ) : null}
          <FileRequestFormSheet
            eventSlug={event.slug}
            request={{
              id: request.id,
              targetKind: request.targetKind,
              title: version.title,
              instructions: version.instructions,
              dueOffsetDays: version.dueOffsetDays,
              allowedContentTypes: version.allowedContentTypes,
              maxBytes: version.maxBytes,
              replacementPolicy: version.replacementPolicy,
            }}
          />
          <form
            action={
              archived
                ? restoreFileRequestAction.bind(null, event.slug, request.id)
                : archiveFileRequestAction.bind(null, event.slug, request.id)
            }
          >
            <Button type="submit" variant="outline">
              {archived ? <ArchiveRestore data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
              {archived ? "Restore" : "Archive"}
            </Button>
          </form>
        </div>
      </header>

      {notice ? (
        <Alert>
          <AlertTitle>File request updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to update this file request</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
            <CardDescription>Shown to participants alongside the upload field.</CardDescription>
          </CardHeader>
          <CardContent>
            {version.instructions ? (
              <p className="whitespace-pre-wrap text-sm">{version.instructions}</p>
            ) : (
              <p className="text-muted-foreground text-sm">No instructions were provided.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upload rules</CardTitle>
            <CardDescription>Captured on each assignment when it is created.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">Accepted types</span>
              <span>{version.allowedContentTypes.map(contentTypeLabel).join(", ")}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">Maximum size</span>
              <span>{formatBytes(version.maxBytes)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">Due</span>
              <span>{dueWording(version.dueOffsetDays)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">Re-uploads</span>
              <span>
                {version.replacementPolicy === "REPLACE_LATEST"
                  ? "Replace the previous file"
                  : "Keep every uploaded file"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assign this request</CardTitle>
          <CardDescription>
            {archived
              ? "Restore this request before assigning it to anyone else."
              : `Pick a ${TARGET_KIND_LABELS[request.targetKind].toLowerCase().replace(/s$/, "")} that has not been assigned yet.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {targets.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Every eligible target already has an assignment for this request.
            </p>
          ) : (
            <form
              action={assignFileRequestAction.bind(null, event.slug, request.id)}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <input name="targetKind" type="hidden" value={request.targetKind} />
              <Field className="sm:max-w-sm">
                <FieldLabel htmlFor="assign-target">Target</FieldLabel>
                <NativeSelect
                  className="w-full"
                  defaultValue=""
                  disabled={archived}
                  id="assign-target"
                  name="targetId"
                  required
                >
                  <NativeSelectOption disabled value="">
                    Choose a target…
                  </NativeSelectOption>
                  {targets.map((target) => (
                    <NativeSelectOption key={target.id} value={target.id}>
                      {target.label} — {target.description}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>The assignment captures today's upload rules.</FieldDescription>
              </Field>
              <Button disabled={archived} type="submit">
                Assign
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Collected files</CardTitle>
          <CardDescription>
            {assignments.length === 0
              ? "No assignments yet."
              : `${collected} of ${assignments.length} assignment${assignments.length === 1 ? "" : "s"} fulfilled`}
          </CardDescription>
        </CardHeader>
        <CardContent className={assignments.length === 0 ? undefined : "px-0"}>
          {assignments.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileUp />
                </EmptyMedia>
                <EmptyTitle>Nothing assigned yet</EmptyTitle>
                <EmptyDescription>Assign this request above to start collecting files.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableCaption className="sr-only">Assignments and collected files for {version.title}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Assigned to</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden md:table-cell">Due</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment) => {
                  const assignmentFiles = filesByAssignment.get(assignment.id) ?? [];
                  return (
                    <TableRow key={assignment.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{assignment.target.label}</span>
                          <span className="text-muted-foreground text-xs">
                            version {assignment.version.versionNumber} · {formatBytes(assignment.version.maxBytes)} max
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant={STATUS_VARIANTS[assignment.status]}>{assignment.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{formatDate(assignment.dueAt)}</TableCell>
                      <TableCell>
                        {assignmentFiles.length === 0 ? (
                          <span className="text-muted-foreground text-sm">No files uploaded</span>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {assignmentFiles.map((file) => (
                              <li className="flex flex-wrap items-center gap-2" key={file.id}>
                                <a
                                  className="text-sm underline-offset-4 hover:underline"
                                  href={`${indexHref}/files/${assignment.id}/${file.id}`}
                                >
                                  {file.fileName}
                                </a>
                                <span className="text-muted-foreground text-xs">{formatBytes(file.size)}</span>
                                {file.supersededAt ? <Badge variant="outline">replaced</Badge> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {assignment.status === "WITHDRAWN" ? null : (
                          <form action={withdrawAssignmentAction.bind(null, event.slug, request.id, assignment.id)}>
                            <Button size="sm" type="submit" variant="outline">
                              Withdraw
                            </Button>
                          </form>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
