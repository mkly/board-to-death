import Link from "next/link";

import {
  AlertCircle,
  ArrowDownToLine,
  Cable,
  CheckCircle2,
  CircleAlert,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SpeakerPreview, SpeakerPreviewAction } from "@/server/integrations";
import { speakerMappingSources } from "@/server/integrations";

import { saveSpeakerMapping } from "../actions";

interface SpeakerMappingWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly preview: SpeakerPreview | null;
  readonly notice?: string;
  readonly error?: string;
}

const sourceLabels = {
  "profile.email": "Email",
  "profile.givenName": "Given name",
  "profile.familyName": "Family name",
  "profile.preferredName": "Preferred name",
  "profile.organization": "Organization",
  "profile.jobTitle": "Job title",
} as const;

const actionLabels: Record<SpeakerPreviewAction, string> = {
  create: "Create",
  update: "Update",
  unchanged: "Unchanged",
  skipped: "Skipped",
  invalid: "Invalid",
};

function actionVariant(action: SpeakerPreviewAction): "default" | "secondary" | "outline" | "destructive" {
  if (action === "invalid") return "destructive";
  if (action === "create") return "default";
  if (action === "update" || action === "skipped") return "secondary";
  return "outline";
}

function pageHref(eventSlug: string, page: number): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/integrations?page=${page}`;
}

function connectionTitle(connection: SpeakerPreview["connection"]): string {
  if (connection === "connected") return "Accelevents connected";
  if (connection === "offline") return "Safe offline preview";
  return "Accelevents disconnected";
}

export function SpeakerMappingWorkspace({ event, preview, notice, error }: SpeakerMappingWorkspaceProps) {
  if (!preview) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-semibold text-2xl tracking-tight">Accelevents speaker mapping</h1>
        </header>
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Cable />
            </EmptyMedia>
            <EmptyTitle>Connect Accelevents first</EmptyTitle>
            <EmptyDescription>
              Add an event-scoped Accelevents configuration before mapping and previewing public speaker data.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const saveAction = saveSpeakerMapping.bind(null, event.slug);
  const csvHref = `/dashboard/events/${encodeURIComponent(event.slug)}/integrations/speakers.csv`;
  const summaryCards = [
    { action: "create" as const, icon: UserPlus },
    { action: "update" as const, icon: RefreshCw },
    { action: "unchanged" as const, icon: CheckCircle2 },
    { action: "skipped" as const, icon: Users },
    { action: "invalid" as const, icon: CircleAlert },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-semibold text-2xl tracking-tight">Accelevents speaker mapping</h1>
          <p className="text-muted-foreground text-sm">
            Map consented public profiles and review every create, update, skip, and validation decision before push.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={csvHref}>
            <ArrowDownToLine data-icon="inline-start" />
            Download authorized CSV
          </Link>
        </Button>
      </header>

      {notice ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Mapping saved</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Mapping not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Alert variant={preview.connection === "disconnected" ? "destructive" : "default"}>
        <Cable />
        <AlertTitle>{connectionTitle(preview.connection)}</AlertTitle>
        <AlertDescription>{preview.connectionMessage}</AlertDescription>
      </Alert>

      <form action={saveAction}>
        <Card>
          <CardHeader>
            <CardTitle>Public speaker field mapping</CardTitle>
            <CardDescription>
              Mapping version {preview.mappingVersionNumber}. Saving creates a new immutable version and refreshes the
              preview.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-3">
              {(["email", "firstName", "lastName"] as const).map((field) => (
                <Field key={field}>
                  <FieldLabel htmlFor={`speaker-mapping-${field}`}>{actionLabelsForField(field)}</FieldLabel>
                  <NativeSelect
                    id={`speaker-mapping-${field}`}
                    name={field}
                    defaultValue={preview.mapping[field]}
                    required
                  >
                    {speakerMappingSources.map((source) => (
                      <NativeSelectOption key={source} value={source}>
                        {sourceLabels[source]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldDescription>Required by the Accelevents speaker contract.</FieldDescription>
                </Field>
              ))}
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button type="submit">Save mapping and refresh preview</Button>
          </CardFooter>
        </Card>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {summaryCards.map(({ action, icon: Icon }) => (
          <Card key={action} size="sm">
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <Icon />
                {actionLabels[action]}
              </CardDescription>
              <CardTitle className="text-2xl">{preview.counts[action]}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Speaker push preview</CardTitle>
          <CardDescription>
            {preview.total} event-owned speaker{preview.total === 1 ? "" : "s"}. Private profiles never expose outbound
            fields.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preview.items.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyTitle>No speakers to preview</EmptyTitle>
                <EmptyDescription>Add event speakers or reconnect Accelevents to generate a preview.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Speaker</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Outbound fields</TableHead>
                    <TableHead>Explanation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.items.map((item) => (
                    <TableRow key={item.localId}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{item.displayName}</span>
                          <span className="text-muted-foreground text-xs">{item.remoteId ?? "Not linked"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={actionVariant(item.action)}>{actionLabels[item.action]}</Badge>
                      </TableCell>
                      <TableCell>
                        {item.outbound ? (
                          <div className="flex flex-col gap-1 text-sm">
                            <span>{item.outbound.email}</span>
                            <span className="text-muted-foreground">
                              {item.outbound.firstName} {item.outbound.lastName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Withheld</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md text-muted-foreground">{item.explanation}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        {preview.pageCount > 1 ? (
          <CardFooter>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href={pageHref(event.slug, Math.max(1, preview.page - 1))}
                    aria-disabled={preview.page === 1}
                  />
                </PaginationItem>
                {Array.from({ length: preview.pageCount }, (_, index) => index + 1).map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink href={pageHref(event.slug, page)} isActive={page === preview.page}>
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href={pageHref(event.slug, Math.min(preview.pageCount, preview.page + 1))}
                    aria-disabled={preview.page === preview.pageCount}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}

function actionLabelsForField(field: "email" | "firstName" | "lastName"): string {
  if (field === "email") return "Remote email";
  if (field === "firstName") return "Remote first name";
  return "Remote last name";
}
