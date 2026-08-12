"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Copy, Download, FileChartColumn, Pencil, Plus, Trash2 } from "lucide-react";

import { FormSelect } from "@/components/form-select";
import { Badge } from "@/components/ui/badge";
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useActionToast } from "@/hooks/use-action-toast";

import { mutateReport, type ReportMutationState } from "../actions";

type ReportBaseType = "SESSION" | "CONTACT" | "GROUP" | "EVALUATION_PLAN";
type ReportFilterOperator = "contains" | "equals" | "notEquals" | "greaterThan" | "lessThan";

interface ReportFilter {
  readonly column: string;
  readonly operator: ReportFilterOperator;
  readonly value: string;
}

interface ReportColumnDefinition {
  readonly id: string;
  readonly label: string;
  readonly relatedType?: string;
}

interface SavedReportRecord {
  readonly id: string;
  readonly name: string;
  readonly baseType: ReportBaseType;
  readonly columns: readonly string[];
  readonly filters: readonly ReportFilter[];
}

interface ReportResult {
  readonly columns: readonly { readonly id: string; readonly label: string }[];
  readonly rows: readonly {
    readonly id: string;
    readonly values: Readonly<Record<string, string | number | boolean | null>>;
  }[];
}

interface ReportTemplateOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

interface ReportWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly reports: readonly SavedReportRecord[];
  readonly selectedReportId: string | null;
  readonly result: ReportResult | null;
  readonly catalog: Readonly<Record<ReportBaseType, readonly ReportColumnDefinition[]>>;
  readonly templates: readonly ReportTemplateOption[];
}

const INITIAL_STATE: ReportMutationState = { status: "idle" };

const reportBaseTypes = ["SESSION", "CONTACT", "GROUP", "EVALUATION_PLAN"] as const;

const baseTypeLabels: Readonly<Record<ReportBaseType, string>> = {
  SESSION: "Sessions",
  CONTACT: "Contacts",
  GROUP: "Groups",
  EVALUATION_PLAN: "Evaluation plans",
};

const operatorLabels: Readonly<Record<ReportFilter["operator"], string>> = {
  contains: "contains",
  equals: "equals",
  notEquals: "does not equal",
  greaterThan: "is greater than",
  lessThan: "is less than",
};

interface EditableReportFilter extends ReportFilter {
  readonly key: string;
}

function ReportEditor({
  eventSlug,
  report,
  catalog,
  action,
  pending,
  state,
}: {
  readonly eventSlug: string;
  readonly report?: SavedReportRecord;
  readonly catalog: ReportWorkspaceProps["catalog"];
  readonly action: (payload: FormData) => void;
  readonly pending: boolean;
  readonly state: ReportMutationState;
}) {
  const [open, setOpen] = useState(false);
  const [baseType, setBaseType] = useState<ReportBaseType>(report?.baseType ?? "SESSION");
  const [columns, setColumns] = useState<string[]>(report?.columns ? [...report.columns] : ["title", "speakers"]);
  const [filters, setFilters] = useState<EditableReportFilter[]>(
    report?.filters.map((filter, index) => ({ ...filter, key: `${report.id}-${index}` })) ?? [],
  );
  const nextFilterKey = useRef(filters.length);
  const availableColumns = catalog[baseType];

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);
  useActionToast(state);

  function changeBaseType(value: ReportBaseType) {
    setBaseType(value);
    setColumns(catalog[value].slice(0, 2).map(({ id }) => id));
    setFilters([]);
  }

  function toggleColumn(column: string, checked: boolean) {
    setColumns((current) => (checked ? [...new Set([...current, column])] : current.filter((id) => id !== column)));
  }

  function updateFilter(index: number, update: Partial<ReportFilter>) {
    setFilters((current) =>
      current.map((filter, position) => (position === index ? { ...filter, ...update } : filter)),
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {report ? (
          <Button size="sm" variant="outline">
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            New report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form noValidate action={action} className="flex flex-col gap-5">
          <input type="hidden" name="intent" value={report ? "update" : "create"} />
          <input type="hidden" name="eventSlug" value={eventSlug} />
          {report ? <input type="hidden" name="reportId" value={report.id} /> : null}
          <input type="hidden" name="columns" value={JSON.stringify(columns)} />
          <input
            type="hidden"
            name="filters"
            value={JSON.stringify(filters.map(({ column, operator, value }) => ({ column, operator, value })))}
          />
          <DialogHeader>
            <DialogTitle>{report ? "Edit report" : "Create custom report"}</DialogTitle>
            <DialogDescription>
              Choose a primary record type, related fields, and filters. Every filter must match for a row to appear.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(state.errors?.name) || undefined}>
              <FieldLabel htmlFor={`report-name-${report?.id ?? "new"}`}>Name</FieldLabel>
              <Input
                id={`report-name-${report?.id ?? "new"}`}
                name="name"
                defaultValue={report?.name}
                placeholder="Program readiness"
                aria-invalid={Boolean(state.errors?.name) || undefined}
                required
              />
              <FieldError>{state.errors?.name?.[0]}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={`report-base-${report?.id ?? "new"}`}>Primary record type</FieldLabel>
              <Select
                name="baseType"
                value={baseType}
                onValueChange={(value) => changeBaseType(value as ReportBaseType)}
              >
                <SelectTrigger id={`report-base-${report?.id ?? "new"}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    {reportBaseTypes.map((value) => (
                      <SelectItem key={value} value={value}>
                        {baseTypeLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Columns</FieldLegend>
              <FieldDescription>Select fields from the primary record and its related records.</FieldDescription>
              <FieldGroup className="grid gap-3 sm:grid-cols-2">
                {availableColumns.map((column) => (
                  <Field key={column.id} orientation="horizontal">
                    <Checkbox
                      id={`${report?.id ?? "new"}-${column.id}`}
                      checked={columns.includes(column.id)}
                      onCheckedChange={(checked) => toggleColumn(column.id, checked === true)}
                    />
                    <FieldLabel htmlFor={`${report?.id ?? "new"}-${column.id}`} className="font-normal">
                      {column.label}
                      {column.relatedType ? <Badge variant="secondary">{column.relatedType}</Badge> : null}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldGroup>
              {columns.length === 0 ? <FieldError>Choose at least one column.</FieldError> : null}
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Filters</FieldLegend>
              <FieldDescription>All conditions must match. Up to ten filters can be saved.</FieldDescription>
              <FieldGroup>
                {filters.map((filter, index) => (
                  <Field key={filter.key} orientation="responsive">
                    <FormSelect
                      aria-label={`Filter ${index + 1} field`}
                      value={filter.column}
                      onValueChange={(value) => updateFilter(index, { column: value })}
                      options={availableColumns.map((column) => ({ value: column.id, label: column.label }))}
                    />
                    <FormSelect
                      aria-label={`Filter ${index + 1} operator`}
                      value={filter.operator}
                      onValueChange={(value) => updateFilter(index, { operator: value as ReportFilter["operator"] })}
                      options={Object.entries(operatorLabels).map(([operator, label]) => ({
                        value: operator,
                        label,
                      }))}
                    />
                    <Input
                      aria-label={`Filter ${index + 1} value`}
                      value={filter.value}
                      onChange={(event) => updateFilter(index, { value: event.target.value })}
                      placeholder="Value"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setFilters((current) => current.filter((_, position) => position !== index))}
                    >
                      <Trash2 />
                      <span className="sr-only">Remove filter</span>
                    </Button>
                  </Field>
                ))}
              </FieldGroup>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={filters.length >= 10}
                onClick={() =>
                  setFilters((current) => [
                    ...current,
                    {
                      column: availableColumns[0]?.id ?? "",
                      operator: "contains",
                      value: "",
                      key: `filter-${nextFilterKey.current++}`,
                    },
                  ])
                }
              >
                <Plus data-icon="inline-start" />
                Add filter
              </Button>
            </FieldSet>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="submit"
              disabled={pending || columns.length === 0 || filters.some(({ value }) => !value.trim())}
            >
              {pending ? <Spinner data-icon="inline-start" /> : <FileChartColumn data-icon="inline-start" />}
              {pending ? "Saving..." : "Save report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReportTable({ result }: { readonly result: ReportResult }) {
  if (result.rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No matching rows</EmptyTitle>
          <EmptyDescription>Adjust the saved filters or add records to this event.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {result.columns.map((column) => (
            <TableHead key={column.id}>{column.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {result.rows.map((row) => (
          <TableRow key={row.id}>
            {result.columns.map((column) => (
              <TableCell key={column.id}>{String(row.values[column.id] ?? "—")}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ReportWorkspace({
  event,
  reports,
  selectedReportId,
  result,
  catalog,
  templates,
}: ReportWorkspaceProps) {
  const router = useRouter();
  const [state, action, pending] = useActionState(mutateReport, INITIAL_STATE);
  const selected = useMemo(
    () => reports.find(({ id }) => id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );

  useEffect(() => {
    if (state.status === "success" && state.reportId) {
      router.replace(`/dashboard/events/${encodeURIComponent(event.slug)}/reports?report=${state.reportId}`);
    }
  }, [event.slug, router, state]);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="reports-heading">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 id="reports-heading" className="font-semibold text-2xl tracking-tight">
            Reports
          </h1>
          <p className="text-muted-foreground">
            Build reusable, event-scoped views over sessions, contacts, groups, and evaluation plans.
          </p>
        </div>
        <ReportEditor eventSlug={event.slug} catalog={catalog} action={action} pending={pending} state={state} />
      </header>

      {reports.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Start from a template</CardTitle>
            <CardDescription>Use a common program report now, then edit its fields and filters.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {templates.map((template) => (
              <Card key={template.id} size="sm">
                <CardHeader>
                  <CardTitle>{template.name}</CardTitle>
                  <CardDescription>{template.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form noValidate action={action}>
                    <input type="hidden" name="intent" value="template" />
                    <input type="hidden" name="eventSlug" value={event.slug} />
                    <input type="hidden" name="templateId" value={template.id} />
                    <Button type="submit" variant="outline" size="sm" disabled={pending}>
                      <Plus data-icon="inline-start" />
                      Use template
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Saved reports</CardTitle>
              <CardDescription>{reports.length} available for this event</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {reports.map((report) => (
                <Button key={report.id} asChild variant={report.id === selectedReportId ? "secondary" : "ghost"}>
                  <Link href={`?report=${report.id}`}>{report.name}</Link>
                </Button>
              ))}
            </CardContent>
          </Card>

          {selected && result ? (
            <Card>
              <CardHeader>
                <CardTitle>{selected.name}</CardTitle>
                <CardDescription>
                  {baseTypeLabels[selected.baseType]} · {result.rows.length} matching rows · all filters must match
                </CardDescription>
                <CardAction className="flex flex-wrap gap-2">
                  <ReportEditor
                    key={selected.id}
                    eventSlug={event.slug}
                    report={selected}
                    catalog={catalog}
                    action={action}
                    pending={pending}
                    state={state}
                  />
                  <form noValidate action={action}>
                    <input type="hidden" name="intent" value="duplicate" />
                    <input type="hidden" name="eventSlug" value={event.slug} />
                    <input type="hidden" name="reportId" value={selected.id} />
                    <Button type="submit" size="sm" variant="outline" disabled={pending}>
                      <Copy data-icon="inline-start" />
                      Duplicate
                    </Button>
                  </form>
                  <form noValidate action={action}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="eventSlug" value={event.slug} />
                    <input type="hidden" name="reportId" value={selected.id} />
                    <Button type="submit" size="icon-sm" variant="ghost" disabled={pending}>
                      <Trash2 />
                      <span className="sr-only">Delete report</span>
                    </Button>
                  </form>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ReportTable result={result} />
              </CardContent>
              <div className="flex flex-wrap gap-2 border-t px-(--card-spacing) pt-(--card-spacing)">
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/dashboard/events/${encodeURIComponent(event.slug)}/reports/${selected.id}/export?format=csv`}
                  >
                    <Download data-icon="inline-start" />
                    Download CSV
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/dashboard/events/${encodeURIComponent(event.slug)}/reports/${selected.id}/export?format=xlsx`}
                  >
                    <Download data-icon="inline-start" />
                    Download XLSX
                  </a>
                </Button>
              </div>
            </Card>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileChartColumn />
                </EmptyMedia>
                <EmptyTitle>Select a report</EmptyTitle>
                <EmptyDescription>Choose a saved report to generate its current result set.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent />
            </Empty>
          )}
        </div>
      )}
    </section>
  );
}
