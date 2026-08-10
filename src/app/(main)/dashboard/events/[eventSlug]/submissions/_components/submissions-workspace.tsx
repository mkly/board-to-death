"use client";

import { useActionState, useState } from "react";

import Link from "next/link";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  CircleIcon,
  Clock3Icon,
  Columns3Icon,
  DownloadIcon,
  FileSearchIcon,
  FileTextIcon,
  type LucideIcon,
  ScanSearchIcon,
  SearchIcon,
} from "lucide-react";

import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  columnLabel,
  defaultSubmissionColumns,
  type SubmissionColumnId,
  submissionBuiltInColumns,
} from "@/lib/cfp/submission-table";
import { cn } from "@/lib/utils";
import type {
  CfpSubmissionFilterOptions,
  CfpSubmissionListItem,
  CfpSubmissionListQuery,
  CfpSubmissionListResult,
} from "@/server/cfp/submissions";

import { resetSubmissionView, saveSubmissionView } from "../actions";

interface SubmissionsWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string; readonly timezone: string };
  readonly filters: CfpSubmissionListQuery;
  readonly options: CfpSubmissionFilterOptions;
  readonly result: CfpSubmissionListResult;
  readonly initialColumns?: readonly SubmissionColumnId[];
  readonly hasSavedView?: boolean;
}

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>["variant"];
type CfpSubmissionKind = NonNullable<CfpSubmissionListQuery["kind"]>;
type CfpSubmissionStatus = NonNullable<CfpSubmissionListQuery["status"]>;

const submissionKinds = ["ABSTRACT", "GUARANTEED_SESSION"] as const satisfies readonly CfpSubmissionKind[];
const submissionStatuses = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "WAITLISTED",
  "ACCEPTED",
  "REJECTED",
  "CONFIRMED",
] as const satisfies readonly CfpSubmissionStatus[];

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
  DRAFT: "secondary",
  SUBMITTED: "secondary",
  UNDER_REVIEW: "secondary",
  WAITLISTED: "secondary",
  ACCEPTED: "default",
  REJECTED: "destructive",
  CONFIRMED: "default",
};

function filterParams(filters: CfpSubmissionListQuery, page?: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.kind) params.set("type", filters.kind);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.assigneeId) params.set("assignee", filters.assigneeId);
  if (filters.sortBy) params.set("sort", filters.sortBy);
  if (filters.sortDirection) params.set("direction", filters.sortDirection);
  if (page && page > 1) params.set("page", String(page));
  return params;
}

function filterHref(eventSlug: string, filters: CfpSubmissionListQuery, page?: number): string {
  const query = filterParams(filters, page).toString();
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/submissions${query ? `?${query}` : ""}`;
}

function exportHref(
  eventSlug: string,
  filters: CfpSubmissionListQuery,
  columns: readonly SubmissionColumnId[],
  format: "csv" | "xlsx",
): string {
  const params = filterParams(filters);
  params.set("format", format);
  for (const column of columns) params.append("column", column);
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/submissions/export?${params.toString()}`;
}

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone = "primary",
}: {
  readonly label: string;
  readonly value: number;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly tone?: "primary" | "secondary";
}) {
  return (
    <Card className="min-h-40 shadow-sm">
      <CardHeader>
        <CardDescription className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
          {label}
        </CardDescription>
        <CardTitle
          className={cn(
            "font-extrabold text-3xl tabular-nums tracking-tight",
            tone === "secondary" ? "text-secondary" : "text-primary",
          )}
        >
          {value}
        </CardTitle>
        <CardAction
          className={cn(
            "flex size-10 items-center justify-center rounded-lg ring-1",
            tone === "secondary"
              ? "bg-secondary/10 text-secondary ring-secondary/25"
              : "bg-primary/10 text-primary ring-primary/20",
          )}
        >
          <Icon className="size-4.5" aria-hidden="true" />
        </CardAction>
      </CardHeader>
      <CardContent className="mt-auto text-muted-foreground text-sm">{description}</CardContent>
    </Card>
  );
}

const ALL_FILTER_VALUE = "all";

function FilterSelect({
  id,
  name,
  ariaLabel,
  defaultValue,
  allLabel,
  options,
  className,
}: {
  readonly id?: string;
  readonly name: string;
  readonly ariaLabel?: string;
  readonly defaultValue: string;
  readonly allLabel?: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly className?: string;
}) {
  const [selected, setSelected] = useState(allLabel && defaultValue === "" ? ALL_FILTER_VALUE : defaultValue);
  const selectedLabel =
    selected === ALL_FILTER_VALUE ? allLabel : options.find((option) => option.value === selected)?.label;
  const choiceCount = options.length + (allLabel ? 1 : 0);

  if (choiceCount <= 1) {
    return (
      <>
        <input type="hidden" name={name} value={selected === ALL_FILTER_VALUE ? "" : selected} />
        <div
          id={id}
          className={cn(
            "flex h-8 w-full min-w-0 items-center rounded-lg border border-input border-dashed py-2 pr-2 pl-2.5 text-muted-foreground text-sm",
            className,
          )}
        >
          <span className="truncate">{selectedLabel}</span>
        </div>
      </>
    );
  }

  return (
    <>
      {/* The GET form expects an empty string for "all"; Radix forbids empty SelectItem values, so a hidden input carries the real value. */}
      <input type="hidden" name={name} value={selected === ALL_FILTER_VALUE ? "" : selected} />
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-full", className)}>
          {/* Radix SelectValue can't resolve item text on the server; render the label directly so it shows on first paint. */}
          <SelectValue>
            <span className="truncate">{selectedLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper">
          {allLabel && <SelectItem value={ALL_FILTER_VALUE}>{allLabel}</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
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
      className="rounded-xl border bg-card p-5 shadow-xs"
    >
      <FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-[minmax(14rem,1fr)_repeat(4,minmax(8rem,0.45fr))_minmax(9rem,0.5fr)_auto]">
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
              placeholder="Search submissions"
            />
          </InputGroup>
        </Field>
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-status">
            Status
          </FieldLabel>
          <FilterSelect
            id="submission-status"
            name="status"
            defaultValue={filters.status ?? ""}
            allLabel="All statuses"
            options={submissionStatuses.map((status) => ({ value: status, label: statusLabels[status] }))}
          />
        </Field>
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-type">
            Type
          </FieldLabel>
          <FilterSelect
            id="submission-type"
            name="type"
            defaultValue={filters.kind ?? ""}
            allLabel="All types"
            options={submissionKinds.map((kind) => ({ value: kind, label: kindLabels[kind] }))}
          />
        </Field>
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-category">
            Category
          </FieldLabel>
          <FilterSelect
            id="submission-category"
            name="category"
            defaultValue={filters.categoryId ?? ""}
            allLabel="All categories"
            options={options.categories.map((category) => ({ value: category.id, label: category.label }))}
          />
        </Field>
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-assignee">
            Assignee
          </FieldLabel>
          <FilterSelect
            id="submission-assignee"
            name="assignee"
            defaultValue={filters.assigneeId ?? ""}
            allLabel="All assignees"
            options={options.assignees.map((assignee) => ({ value: assignee.id, label: assignee.displayName }))}
          />
        </Field>
        <Field>
          <FieldLabel className="sr-only" htmlFor="submission-sort">
            Sort submissions
          </FieldLabel>
          <div className="flex gap-2">
            <FilterSelect
              id="submission-sort"
              name="sort"
              defaultValue={filters.sortBy ?? "submittedAt"}
              className="min-w-0 flex-1"
              options={[
                { value: "submittedAt", label: "Submitted" },
                { value: "updatedAt", label: "Updated" },
                { value: "status", label: "Status" },
                { value: "formTitle", label: "Submission" },
              ]}
            />
            <FilterSelect
              name="direction"
              ariaLabel="Sort direction"
              defaultValue={filters.sortDirection ?? "desc"}
              className="w-28"
              options={[
                { value: "desc", label: "Newest" },
                { value: "asc", label: "Oldest" },
              ]}
            />
          </div>
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-1">
          <Button type="submit" className="flex-1 2xl:flex-none">
            Apply
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/dashboard/events/${encodeURIComponent(eventSlug)}/submissions?clear=1`}>Clear</Link>
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

function displayCell(
  item: CfpSubmissionListItem,
  column: SubmissionColumnId,
  eventSlug: string,
  dateFormatter: Intl.DateTimeFormat,
) {
  switch (column) {
    case "formTitle":
      return (
        <Link
          className="block max-w-64 truncate font-medium hover:underline"
          href={`/dashboard/events/${encodeURIComponent(eventSlug)}/submissions/${item.id}`}
        >
          {item.formTitle}
        </Link>
      );
    case "applicant":
      return item.applicants.map(({ name }) => name).join(", ") || "Not assigned";
    case "email":
      return item.applicants.map(({ email }) => email).join(", ") || "—";
    case "kind":
      return kindLabels[item.kind];
    case "categories":
      return item.categories.length > 0 ? (
        <div className="flex max-w-56 flex-wrap gap-1">
          {item.categories.map((category) => (
            <Badge key={category.id} variant="outline">
              {category.label}
            </Badge>
          ))}
        </div>
      ) : (
        "—"
      );
    case "assignees":
      return item.assignees.map(({ displayName }) => displayName).join(", ") || "Unassigned";
    case "status":
      return (
        <Badge variant={statusVariants[item.status]}>
          <CircleIcon aria-hidden="true" className="fill-current" data-icon="inline-start" />
          {statusLabels[item.status]}
        </Badge>
      );
    case "submittedAt":
      return item.submittedAt ? dateFormatter.format(item.submittedAt) : "Draft";
    case "updatedAt":
      return dateFormatter.format(item.updatedAt);
    case "averageScore":
      return item.averageScore === null ? "—" : item.averageScore.toFixed(2);
    case "reviewProgress":
      return `${item.completedReviews}/${item.totalReviews}`;
    default:
      return item.answers[column.slice(7)] || "—";
  }
}

function ColumnDialog({
  eventSlug,
  filters,
  options,
  columns,
  setColumns,
  hasSavedView,
}: {
  readonly eventSlug: string;
  readonly filters: CfpSubmissionListQuery;
  readonly options: CfpSubmissionFilterOptions;
  readonly columns: readonly SubmissionColumnId[];
  readonly setColumns: (columns: readonly SubmissionColumnId[]) => void;
  readonly hasSavedView: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveSubmissionView, { status: "idle" });
  const customLabels = Object.fromEntries(options.customColumns.map(({ id, label }) => [id, label]));
  const available = [
    ...submissionBuiltInColumns.map((column) => ({ ...column, id: column.id as SubmissionColumnId })),
    ...options.customColumns.map((column) => ({
      ...column,
      id: `answer:${column.id}` as SubmissionColumnId,
      group: "custom",
    })),
  ];
  const toggle = (id: SubmissionColumnId, checked: boolean) => {
    if (checked) setColumns([...columns, id]);
    else if (columns.length > 1) setColumns(columns.filter((column) => column !== id));
  };
  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= columns.length) return;
    const next = [...columns];
    const current = next[index];
    const target = next[destination];
    if (!current || !target) return;
    next[index] = target;
    next[destination] = current;
    setColumns(next);
  };
  const view = JSON.stringify({
    columns,
    filters: {
      search: filters.search,
      status: filters.status,
      kind: filters.kind,
      categoryId: filters.categoryId,
      assigneeId: filters.assigneeId,
    },
    sorting: { id: filters.sortBy ?? "submittedAt", direction: filters.sortDirection ?? "desc" },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Columns3Icon data-icon="inline-start" />
          Columns
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Configure submission table</DialogTitle>
          <DialogDescription>
            Choose columns, set their order, and save the current filters for this event.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-96 gap-5 overflow-y-auto pr-1 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <p className="font-medium text-sm">Available columns</p>
            {(["built-in", "custom", "reporting"] as const).map((group) => (
              <div className="flex flex-col gap-2" key={group}>
                <p className="text-muted-foreground text-xs capitalize">{group.replace("-", " ")}</p>
                {available
                  .filter((column) => column.group === group)
                  .map((column) => (
                    <label className="flex items-center gap-2 text-sm" htmlFor={`column-${column.id}`} key={column.id}>
                      <Checkbox
                        id={`column-${column.id}`}
                        checked={columns.includes(column.id)}
                        onCheckedChange={(checked) => toggle(column.id, checked === true)}
                      />
                      {column.label}
                    </label>
                  ))}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium text-sm">Column order</p>
            {columns.map((column, index) => (
              <div className="flex items-center gap-1 rounded-lg border p-1.5" key={column}>
                <span className="min-w-0 flex-1 truncate px-1 text-sm">{columnLabel(column, customLabels)}</span>
                <Button
                  aria-label={`Move ${columnLabel(column, customLabels)} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  aria-label={`Move ${columnLabel(column, customLabels)} down`}
                  disabled={index === columns.length - 1}
                  onClick={() => move(index, 1)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <ArrowDownIcon />
                </Button>
              </div>
            ))}
          </div>
        </div>
        {state.message ? (
          <p
            aria-live="polite"
            className={cn("text-sm", state.status === "error" ? "text-destructive" : "text-muted-foreground")}
          >
            {state.message}
          </p>
        ) : null}
        <DialogFooter>
          {hasSavedView ? (
            <form action={resetSubmissionView.bind(null, eventSlug)}>
              <Button type="submit" variant="ghost">
                Reset saved view
              </Button>
            </form>
          ) : null}
          <form action={formAction}>
            <input type="hidden" name="eventSlug" value={eventSlug} />
            <input type="hidden" name="view" value={view} />
            <Button disabled={pending} type="submit">
              {pending ? "Saving…" : "Save view"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SubmissionsWorkspace({
  event,
  filters,
  options,
  result,
  initialColumns = defaultSubmissionColumns,
  hasSavedView = false,
}: SubmissionsWorkspaceProps) {
  const [columns, setColumns] = useState<readonly SubmissionColumnId[]>(initialColumns);
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: event.timezone,
  });
  const customLabels = Object.fromEntries(options.customColumns.map(({ id, label }) => [id, label]));
  const decided =
    result.metrics.WAITLISTED + result.metrics.ACCEPTED + result.metrics.REJECTED + result.metrics.CONFIRMED;
  const firstVisible = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastVisible = Math.min(result.total, result.page * result.pageSize);

  return (
    <main className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="font-medium text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-3xl tracking-tight sm:text-4xl">Submissions</h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Track proposal intake, review progress, and final decisions for your event.
        </p>
      </header>
      <section aria-label="Submission lifecycle metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total submissions"
          value={Object.values(result.metrics).reduce((sum, count) => sum + count, 0)}
          description="All lifecycle states"
          icon={FileTextIcon}
        />
        <MetricCard
          label="Awaiting review"
          value={result.metrics.SUBMITTED}
          description="Submitted and not yet started"
          icon={Clock3Icon}
          tone="secondary"
        />
        <MetricCard
          label="In review"
          value={result.metrics.UNDER_REVIEW}
          description="Actively under evaluation"
          icon={ScanSearchIcon}
        />
        <MetricCard
          label="Decisions"
          value={decided}
          description="Waitlisted, accepted, rejected, or confirmed"
          icon={CircleCheckIcon}
          tone="secondary"
        />
      </section>
      <nav aria-label="Submission status" className="flex flex-wrap gap-2">
        <Button size="sm" variant={filters.status ? "ghost" : "secondary"} asChild>
          <Link href={filterHref(event.slug, { ...filters, status: undefined }, 1)}>All</Link>
        </Button>
        {submissionStatuses.map((status) => (
          <Button key={status} size="sm" variant={filters.status === status ? "secondary" : "ghost"} asChild>
            <Link href={filterHref(event.slug, { ...filters, status }, 1)}>
              {statusLabels[status]}{" "}
              <span className="text-muted-foreground tabular-nums">{result.metrics[status]}</span>
            </Link>
          </Button>
        ))}
      </nav>
      <FilterBar eventSlug={event.slug} filters={filters} options={options} />
      <Card className="shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Submission queue</CardTitle>
            <CardDescription>
              {result.total === 0
                ? "No matching submissions"
                : `Showing ${firstVisible}–${lastVisible} of ${result.total}`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <ColumnDialog
              eventSlug={event.slug}
              filters={filters}
              options={options}
              columns={columns}
              setColumns={setColumns}
              hasSavedView={hasSavedView}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <DownloadIcon data-icon="inline-start" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Filtered result set</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <a href={exportHref(event.slug, filters, columns, "csv")}>CSV spreadsheet</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref(event.slug, filters, columns, "xlsx")}>Excel workbook</a>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((column) => (
                      <TableHead key={column} className="whitespace-nowrap first:pl-4 last:pr-4">
                        {columnLabel(column, customLabels)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((item) => (
                    <TableRow key={item.id}>
                      {columns.map((column) => (
                        <TableCell key={column} className="max-w-72 align-top first:pl-4 last:pr-4">
                          {displayCell(item, column, event.slug, dateFormatter)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
