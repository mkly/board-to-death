import Link from "next/link";

import { ArchiveRestore, Download, FileUp } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FileRequestTargetKind } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";
import type { FileRequestWithVersion } from "@/server/files/repositories";

import { restoreFileRequestAction } from "../actions";
import { FileRequestFormSheet } from "./file-request-form-sheet";
import { contentTypeLabel, formatBytes, TARGET_KIND_LABELS } from "./file-request-options";

const TABS: readonly { readonly id: string; readonly label: string; readonly kind?: FileRequestTargetKind }[] = [
  { id: "all", label: "All Requests" },
  { id: "contact", label: "Contact Requests", kind: "CONTACT" },
  { id: "group", label: "Group Requests", kind: "GROUP" },
  { id: "submission", label: "Submission Requests", kind: "SUBMISSION" },
];

function indexHref(eventSlug: string, tab: string): string {
  const base = `/dashboard/events/${encodeURIComponent(eventSlug)}/file-requests`;
  return tab === "all" ? base : `${base}?tab=${tab}`;
}

function requestHref(eventSlug: string, requestId: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/file-requests/${requestId}`;
}

function dueLabel(dueOffsetDays: number | null): string {
  if (dueOffsetDays === null) return "No due date";
  return dueOffsetDays === 0 ? "Event start" : `${dueOffsetDays} days before start`;
}

export function FileRequestsIndex({
  event,
  requests,
  activeTab,
  notice,
  error,
}: {
  readonly event: { readonly name: string; readonly slug: string };
  readonly requests: readonly FileRequestWithVersion[];
  readonly activeTab: string;
  readonly notice?: string;
  readonly error?: string;
}) {
  const counts = new Map(
    TABS.map((tab) => [tab.id, requests.filter((request) => !tab.kind || request.targetKind === tab.kind).length]),
  );
  const selected = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
  const visible = selected.kind ? requests.filter((request) => request.targetKind === selected.kind) : requests;
  const collected = requests.reduce((total, request) => total + request.fulfilledCount, 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-muted-foreground text-sm">{event.name}</p>
          <h1 className="flex items-center gap-2 font-medium text-2xl leading-tight tracking-tight sm:text-3xl sm:leading-none">
            <FileUp aria-hidden="true" className="size-6 text-muted-foreground" />
            File Requests
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            Collect files (e.g. documents, contracts) from your portals. Uploaded files are stored here for download or
            export — they are not attached to a submission or contact record.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {collected > 0 ? (
            <Button asChild variant="outline">
              <a href={`/dashboard/events/${encodeURIComponent(event.slug)}/file-requests/export`}>
                <Download data-icon="inline-start" />
                Export all files
              </a>
            </Button>
          ) : null}
          <FileRequestFormSheet eventSlug={event.slug} />
        </div>
      </header>

      {notice ? (
        <Alert>
          <AlertTitle>File requests updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to update file requests</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <nav aria-label="File request types" className="flex flex-wrap gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            aria-current={tab.id === selected.id ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 font-medium text-sm transition-colors",
              tab.id === selected.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            href={indexHref(event.slug, tab.id)}
            key={tab.id}
          >
            {tab.label}
            <span className="text-muted-foreground text-xs">{counts.get(tab.id) ?? 0}</span>
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>{selected.label}</CardTitle>
          <CardDescription>
            {visible.length === 0
              ? "No file requests match this type."
              : `${visible.length} file request${visible.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent className={visible.length === 0 ? undefined : "px-0"}>
          {visible.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileUp />
                </EmptyMedia>
                <EmptyTitle>No file requests yet</EmptyTitle>
                <EmptyDescription>Create a file request to collect documents from participants</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <FileRequestFormSheet eventSlug={event.slug} label="Add file request" />
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableCaption className="sr-only">File requests for {event.name}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="hidden md:table-cell">Due</TableHead>
                  <TableHead className="hidden lg:table-cell">Accepted</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.length > 0 &&
                  visible.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Link
                            className="font-medium underline-offset-4 hover:underline"
                            href={requestHref(event.slug, request.id)}
                          >
                            {request.currentVersion.title}
                          </Link>
                          <span className="text-muted-foreground text-xs">
                            {request.key} · version {request.currentVersion.versionNumber} ·{" "}
                            {formatBytes(request.currentVersion.maxBytes)} max
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary">{TARGET_KIND_LABELS[request.targetKind]}</Badge>
                          {request.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {dueLabel(request.currentVersion.dueOffsetDays)}
                      </TableCell>
                      <TableCell className="hidden max-w-56 truncate lg:table-cell">
                        {request.currentVersion.allowedContentTypes.map(contentTypeLabel).join(", ")}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {request.fulfilledCount}/{request.assignmentCount}
                      </TableCell>
                      <TableCell className="text-right">
                        {request.archivedAt ? (
                          <form action={restoreFileRequestAction.bind(null, event.slug, request.id)}>
                            <Button size="sm" type="submit" variant="outline">
                              <ArchiveRestore data-icon="inline-start" />
                              Restore
                            </Button>
                          </form>
                        ) : (
                          <Button asChild size="sm" variant="outline">
                            <Link href={requestHref(event.slug, request.id)}>Manage</Link>
                          </Button>
                        )}
                      </TableCell>
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
