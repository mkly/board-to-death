import Link from "next/link";

import { FileSearchIcon, SearchIcon, UsersIcon } from "lucide-react";

import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
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
import { CfpSubmissionKind, CfpSubmissionStatus } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";
import type {
  CfpSubmissionFilterOptions,
  CfpSubmissionListQuery,
  CfpSubmissionListResult,
} from "@/server/cfp/submissions";

interface SubmissionsWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string; readonly timezone: string };
  readonly filters: CfpSubmissionListQuery;
  readonly options: CfpSubmissionFilterOptions;
  readonly result: CfpSubmissionListResult;
}

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>["variant"];

const statusLabels: Readonly<Record<CfpSubmissionStatus, string>> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  WAITLISTED: "Waitlisted",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  CONFIRMED: "Confirmed",
};

const kindLabels: Readonly<Record<CfpSubmissionKind, string>> = {
  ABSTRACT: "Abstract",
  GUARANTEED_SESSION: "Guaranteed session",
};

const statusVariants: Readonly<Record<CfpSubmissionStatus, BadgeVariant>> = {
  DRAFT: "outline",
  SUBMITTED: "secondary",
  UNDER_REVIEW: "default",
  WAITLISTED: "outline",
  ACCEPTED: "default",
  REJECTED: "destructive",
  CONFIRMED: "secondary",
};

function filterHref(eventSlug: string, filters: CfpSubmissionListQuery, page: number): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.kind) params.set("type", filters.kind);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.assigneeId) params.set("assignee", filters.assigneeId);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/submissions${query ? `?${query}` : ""}`;
}

function MetricCard({
  label,
  value,
  description,
}: {
  readonly label: string;
  readonly value: number;
  readonly description: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-xs">{description}</CardContent>
    </Card>
  );
}

function FilterBar({
  eventSlug,
  filters,
  options,
}: Pick<SubmissionsWorkspaceProps, "filters" | "options"> & { readonly eventSlug: string }) {
  return (
    <form
      action={`/dashboard/events/${encodeURIComponent(eventSlug)}/submissions`}
      className="rounded-xl border bg-card p-4"
    >
      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(14rem,1fr)_repeat(4,minmax(8rem,0.45fr))_auto]">
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-search">
            Search submissions
          </FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id="submission-search"
              name="q"
              defaultValue={filters.search}
              placeholder="Search applicants, forms, or reviewers"
            />
          </InputGroup>
        </Field>
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-status">
            Status
          </FieldLabel>
          <NativeSelect id="submission-status" name="status" defaultValue={filters.status ?? ""} className="w-full">
            <NativeSelectOption value="">All statuses</NativeSelectOption>
            {Object.values(CfpSubmissionStatus).map((status) => (
              <NativeSelectOption key={status} value={status}>
                {statusLabels[status]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-type">
            Type
          </FieldLabel>
          <NativeSelect id="submission-type" name="type" defaultValue={filters.kind ?? ""} className="w-full">
            <NativeSelectOption value="">All types</NativeSelectOption>
            {Object.values(CfpSubmissionKind).map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {kindLabels[kind]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-category">
            Category
          </FieldLabel>
          <NativeSelect
            id="submission-category"
            name="category"
            defaultValue={filters.categoryId ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">All categories</NativeSelectOption>
            {options.categories.map((category) => (
              <NativeSelectOption key={category.id} value={category.id}>
                {category.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-assignee">
            Assignee
          </FieldLabel>
          <NativeSelect
            id="submission-assignee"
            name="assignee"
            defaultValue={filters.assigneeId ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">All assignees</NativeSelectOption>
            {options.assignees.map((assignee) => (
              <NativeSelectOption key={assignee.id} value={assignee.id}>
                {assignee.displayName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1 2xl:col-span-1">
          <Button type="submit" className="flex-1 2xl:flex-none">
            Apply
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/dashboard/events/${encodeURIComponent(eventSlug)}/submissions`}>Reset</Link>
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

export function SubmissionsWorkspace({ event, filters, options, result }: SubmissionsWorkspaceProps) {
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: event.timezone,
  });
  const decided =
    result.metrics.WAITLISTED + result.metrics.ACCEPTED + result.metrics.REJECTED + result.metrics.CONFIRMED;
  const firstVisible = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastVisible = Math.min(result.total, result.page * result.pageSize);

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">Submissions</h1>
        <p className="text-muted-foreground text-sm">Track proposal intake, review progress, and decisions.</p>
      </header>

      <section aria-label="Submission lifecycle metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total submissions"
          value={Object.values(result.metrics).reduce((sum, count) => sum + count, 0)}
          description="All lifecycle states"
        />
        <MetricCard
          label="Awaiting review"
          value={result.metrics.SUBMITTED}
          description="Submitted and not yet started"
        />
        <MetricCard label="In review" value={result.metrics.UNDER_REVIEW} description="Actively under evaluation" />
        <MetricCard label="Decisions" value={decided} description="Waitlisted, accepted, rejected, or confirmed" />
      </section>

      <FilterBar eventSlug={event.slug} filters={filters} options={options} />

      <Card>
        <CardHeader>
          <CardTitle>Submission queue</CardTitle>
          <CardDescription>
            {result.total === 0
              ? "No matching submissions"
              : `Showing ${firstVisible}–${lastVisible} of ${result.total}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {result.items.length === 0 ? (
            <Empty className="min-h-72 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSearchIcon />
                </EmptyMedia>
                <EmptyTitle>No submissions found</EmptyTitle>
                <EmptyDescription>Adjust the filters or wait for new proposals to arrive.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Submission</TableHead>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell className="max-w-64 pl-4">
                      <Link
                        className="block truncate font-medium hover:underline"
                        href={`/dashboard/events/${encodeURIComponent(event.slug)}/submissions/${submission.id}`}
                      >
                        {submission.formTitle}
                      </Link>
                      <span className="text-muted-foreground text-xs">{kindLabels[submission.kind]}</span>
                    </TableCell>
                    <TableCell>
                      {submission.applicants[0] ? (
                        <div className="flex max-w-52 flex-col">
                          <span className="truncate">{submission.applicants[0].name}</span>
                          <span className="truncate text-muted-foreground text-xs">
                            {submission.applicants[0].email}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Not assigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {submission.categories.length > 0 ? (
                          submission.categories.map((category) => (
                            <Badge key={category.id} variant="outline">
                              {category.label}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {submission.assignees.length > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <UsersIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                          <span>{submission.assignees.map(({ displayName }) => displayName).join(", ")}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariants[submission.status]}>{statusLabels[submission.status]}</Badge>
                    </TableCell>
                    <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">
                      {submission.submittedAt ? dateFormatter.format(submission.submittedAt) : "Draft"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {result.pageCount > 1 ? (
        <Pagination className="justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href={filterHref(event.slug, filters, Math.max(1, result.page - 1))}
                aria-disabled={result.page === 1}
                className={cn(result.page === 1 && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href={filterHref(event.slug, filters, result.page)} isActive size="default">
                Page {result.page} of {result.pageCount}
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href={filterHref(event.slug, filters, Math.min(result.pageCount, result.page + 1))}
                aria-disabled={result.page === result.pageCount}
                className={cn(result.page === result.pageCount && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </main>
  );
}
