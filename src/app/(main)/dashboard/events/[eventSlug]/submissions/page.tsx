import { notFound, redirect } from "next/navigation";

import { CfpSubmissionKind, CfpSubmissionStatus } from "@/generated/prisma/client";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { CfpSubmissionRepository } from "@/server/cfp/submissions";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { SubmissionsWorkspace } from "./_components/submissions-workspace";

interface SubmissionsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function enumValue<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return value && values.includes(value as T) ? (value as T) : undefined;
}

function pageNumber(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function SubmissionsPage({ params, searchParams }: SubmissionsPageProps) {
  const [{ eventSlug }, rawFilters, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(shell.activeEvent ? dashboardEventHref(shell.activeEvent.slug, "submissions") : "/dashboard");
  }

  const filters = {
    page: pageNumber(first(rawFilters.page)),
    search: first(rawFilters.q)?.trim() || undefined,
    status: enumValue(Object.values(CfpSubmissionStatus), first(rawFilters.status)),
    kind: enumValue(Object.values(CfpSubmissionKind), first(rawFilters.type)),
    categoryId: first(rawFilters.category),
    assigneeId: first(rawFilters.assignee),
  } as const;
  const repository = new CfpSubmissionRepository(getDatabaseClient());
  const [result, options] = await Promise.all([
    repository.listForEvent(event.id, filters),
    repository.getFilterOptions(event.id),
  ]);

  return <SubmissionsWorkspace event={event} filters={filters} options={options} result={result} />;
}
