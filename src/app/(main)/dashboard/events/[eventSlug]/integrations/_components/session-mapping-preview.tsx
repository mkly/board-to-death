"use client";

import { useActionState, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { CircleAlert, Download, Save } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type {
  SessionMappingDefinition,
  SessionPreviewAction,
  SessionPreviewRecord,
  SessionPreviewResult,
} from "@/server/integrations";

import { type SessionMappingMutationState, saveSessionMapping } from "../actions";

interface SessionMappingPreviewProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly connected: boolean;
  readonly remoteEventId: string | null;
  readonly mapping: SessionMappingDefinition;
  readonly mappingVersion: number | null;
  readonly publishedVersion: number | null;
  readonly preview: SessionPreviewResult | null;
}

const PAGE_SIZE = 10;
const REGION_LABEL = "Accelevents session preview";
const INITIAL_STATE: SessionMappingMutationState = { status: "idle" };
const actions: readonly SessionPreviewAction[] = ["create", "update", "unchanged", "skipped", "invalid"];

function actionVariant(action: SessionPreviewAction): "default" | "secondary" | "outline" | "destructive" {
  if (action === "create") return "default";
  if (action === "update") return "secondary";
  if (action === "invalid") return "destructive";
  return "outline";
}

function actionLabel(action: SessionPreviewAction): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function firstError(state: SessionMappingMutationState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function PreviewTable({ records }: { readonly records: readonly SessionPreviewRecord[] }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRecords = records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (records.length === 0) {
    return (
      <Empty className="min-h-56">
        <EmptyHeader>
          <EmptyTitle>No published sessions</EmptyTitle>
          <EmptyDescription>Publish scheduled sessions to populate this preview.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Session</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Speakers</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Explanation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRecords.map((record) => (
            <TableRow key={record.localId}>
              <TableCell className="max-w-64 whitespace-normal">
                <p className="font-medium">{record.title || "Untitled session"}</p>
                <p className="text-muted-foreground text-xs">{record.remoteId ?? "Not linked"}</p>
              </TableCell>
              <TableCell className="whitespace-normal">
                <p>{record.roomName || "No room"}</p>
                <p className="text-muted-foreground text-xs">{record.startsAt || "Not scheduled"}</p>
              </TableCell>
              <TableCell>{record.speakerRemoteIds.length}</TableCell>
              <TableCell>
                <Badge variant={actionVariant(record.action)}>{actionLabel(record.action)}</Badge>
              </TableCell>
              <TableCell className="max-w-80 whitespace-normal text-muted-foreground">
                {record.explanations.join(" ")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pageCount > 1 ? (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#session-preview"
                aria-disabled={currentPage === 1}
                onClick={(event) => {
                  event.preventDefault();
                  setPage((value) => Math.max(1, value - 1));
                }}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-3 text-muted-foreground text-sm">
                Page {currentPage} of {pageCount}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#session-preview"
                aria-disabled={currentPage === pageCount}
                onClick={(event) => {
                  event.preventDefault();
                  setPage((value) => Math.min(pageCount, value + 1));
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}

export function SessionMappingPreview({
  event,
  connected,
  remoteEventId,
  mapping,
  mappingVersion,
  publishedVersion,
  preview,
}: SessionMappingPreviewProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (previous: SessionMappingMutationState, data: FormData) => {
    const result = await saveSessionMapping(previous, data);
    if (result.status === "success") router.refresh();
    return result;
  }, INITIAL_STATE);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        actions.map((action) => [action, preview?.records.filter((record) => record.action === action).length ?? 0]),
      ) as Record<SessionPreviewAction, number>,
    [preview],
  );

  if (!connected) {
    return (
      <section aria-label={REGION_LABEL} className="flex flex-col gap-6">
        <header>
          <h2 className="font-semibold text-2xl tracking-tight">{REGION_LABEL}</h2>
        </header>
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleAlert />
            </EmptyMedia>
            <EmptyTitle>Connect Accelevents first</EmptyTitle>
            <EmptyDescription>
              An event-scoped Accelevents configuration is required before mapping sessions.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    );
  }

  return (
    <section aria-label={REGION_LABEL} className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-semibold text-2xl tracking-tight">{REGION_LABEL}</h2>
        <p className="text-muted-foreground text-sm">
          Map public program fields, validate schedule readiness, and inspect every outbound action before a push.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {actions.map((action) => (
          <Card key={action} size="sm">
            <CardHeader>
              <CardDescription>{actionLabel(action)}</CardDescription>
              <CardTitle className="text-2xl">{counts[action]}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {!publishedVersion ? (
        <Alert>
          <CircleAlert />
          <AlertTitle>Publish the program to preview sessions</AlertTitle>
          <AlertDescription>The preview only reads the latest immutable public program snapshot.</AlertDescription>
        </Alert>
      ) : null}
      {preview?.status === "disconnected" ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Accelevents could not be reached</AlertTitle>
          <AlertDescription>{preview.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(18rem,24rem)_1fr]">
        <form action={formAction}>
          <input type="hidden" name="eventSlug" value={event.slug} />
          <Card>
            <CardHeader>
              <CardTitle>Session field mapping</CardTitle>
              <CardDescription>
                Remote event {remoteEventId} · {mappingVersion ? `mapping v${mappingVersion}` : "default mapping"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field data-invalid={Boolean(firstError(state, "title")) || undefined}>
                  <FieldLabel htmlFor="session-title-source">Accelevents title</FieldLabel>
                  <Select name="title" defaultValue={mapping.title}>
                    <SelectTrigger
                      id="session-title-source"
                      aria-invalid={Boolean(firstError(state, "title")) || undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="session.title">Public session title</SelectItem>
                        <SelectItem value="event.name">Event name</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>Required by Accelevents.</FieldDescription>
                  <FieldError>{firstError(state, "title")}</FieldError>
                </Field>
                <Field data-invalid={Boolean(firstError(state, "description")) || undefined}>
                  <FieldLabel htmlFor="session-description-source">Accelevents description</FieldLabel>
                  <Select name="description" defaultValue={mapping.description}>
                    <SelectTrigger
                      id="session-description-source"
                      aria-invalid={Boolean(firstError(state, "description")) || undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="session.description">Public session description</SelectItem>
                        <SelectItem value="event.theme">Event theme</SelectItem>
                        <SelectItem value="omit">Do not send</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldError>{firstError(state, "description")}</FieldError>
                </Field>
                <Field data-invalid={Boolean(firstError(state, "speakers")) || undefined}>
                  <FieldLabel htmlFor="session-speaker-source">Accelevents speakers</FieldLabel>
                  <Select name="speakers" defaultValue={mapping.speakers}>
                    <SelectTrigger
                      id="session-speaker-source"
                      aria-invalid={Boolean(firstError(state, "speakers")) || undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="linked-speakers">Linked public speakers</SelectItem>
                        <SelectItem value="omit">Do not send</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>Missing linked speakers make a session invalid.</FieldDescription>
                  <FieldError>{firstError(state, "speakers")}</FieldError>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-between gap-3">
              <p aria-live="polite" className="text-muted-foreground text-sm">
                {state.message}
              </p>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                {pending ? "Saving..." : "Save mapping"}
              </Button>
            </CardFooter>
          </Card>
        </form>

        <Card id="session-preview">
          <CardHeader>
            <CardTitle>Outbound session actions</CardTitle>
            <CardDescription>
              {publishedVersion ? `Published program v${publishedVersion}` : "No published program"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PreviewTable records={preview?.records ?? []} />
          </CardContent>
          <CardFooter className="justify-end">
            {publishedVersion ? (
              <Button variant="outline" asChild>
                <a href={`/dashboard/events/${encodeURIComponent(event.slug)}/integrations/session-preview.csv`}>
                  <Download data-icon="inline-start" />
                  Download authorized CSV
                </a>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <Download data-icon="inline-start" />
                Download authorized CSV
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </section>
  );
}
