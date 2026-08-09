import { headers } from "next/headers";

import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { runReport } from "@/server/reports/engine";
import { createReportCsv, createReportXlsx } from "@/server/reports/export";
import { ReportRepository } from "@/server/reports/repository";

interface ReportExportRouteContext {
  readonly params: Promise<{ eventSlug: string; reportId: string }>;
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function safeName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "report"
  );
}

export async function GET(request: Request, { params }: ReportExportRouteContext): Promise<Response> {
  const [{ eventSlug, reportId }, session] = await Promise.all([
    params,
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (!session || !isAllowedAdminEmail(session.user.email)) return new Response("Not found", { status: 404 });

  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true } });
  if (!event) return new Response("Not found", { status: 404 });
  const report = await new ReportRepository(client).get(event.id, reportId);
  if (!report) return new Response("Not found", { status: 404 });

  const format = new URL(request.url).searchParams.get("format");
  if (format !== "csv" && format !== "xlsx") return new Response("Unsupported export format", { status: 400 });
  const result = await runReport(client, event.id, report);
  const bytes = format === "csv" ? createReportCsv(result) : await createReportXlsx(result);
  return new Response(responseBody(bytes), {
    headers: {
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName(report.name)}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
