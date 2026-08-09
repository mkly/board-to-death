import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { reportCatalog, reportTemplates } from "@/server/reports/catalog";
import { runReport } from "@/server/reports/engine";
import { ReportRepository } from "@/server/reports/repository";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { ReportWorkspace } from "./_components/report-workspace";

export default async function ReportsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ report?: string }>;
}) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const repository = new ReportRepository(client);
  const reports = await repository.list(event.id);
  const selected = reports.find(({ id }) => id === query.report) ?? reports[0] ?? null;
  const result = selected ? await runReport(client, event.id, selected) : null;

  return (
    <ReportWorkspace
      event={{ name: event.name, slug: event.slug }}
      reports={reports}
      selectedReportId={selected?.id ?? null}
      result={result}
      catalog={reportCatalog}
      templates={reportTemplates}
    />
  );
}
