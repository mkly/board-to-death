import { headers } from "next/headers";

import { CfpSubmissionKind, CfpSubmissionStatus } from "@/generated/prisma/client";
import { defaultSubmissionColumns, parseSubmissionView } from "@/lib/cfp/submission-table";
import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { createSubmissionCsv, createSubmissionXlsx } from "@/server/cfp/exports";
import { CfpSubmissionRepository, type CfpSubmissionSortKey } from "@/server/cfp/submissions";
import { getDatabaseClient } from "@/server/database/client";

interface ExportRouteContext {
  readonly params: Promise<{ eventSlug: string }>;
}

function enumValue<T extends string>(values: readonly T[], value: string | null): T | undefined {
  return value && values.includes(value as T) ? (value as T) : undefined;
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function GET(request: Request, { params }: ExportRouteContext): Promise<Response> {
  const [{ eventSlug }, session] = await Promise.all([params, auth.api.getSession({ headers: await headers() })]);
  if (!session || !isAllowedAdminEmail(session.user.email)) return new Response("Not found", { status: 404 });

  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
  if (!event) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const format = enumValue(["csv", "xlsx"] as const, url.searchParams.get("format"));
  if (!format) return new Response("Unsupported export format", { status: 400 });

  const savedView = await client.cfpSubmissionView.findUnique({
    where: { eventId_userId: { eventId: event.id, userId: session.user.id } },
    select: { columns: true, filters: true, sorting: true },
  });
  const requestedColumns = url.searchParams.getAll("column");
  const view = parseSubmissionView({
    columns: requestedColumns.length > 0 ? requestedColumns : (savedView?.columns ?? defaultSubmissionColumns),
    filters: {},
    sorting: { id: "submittedAt", direction: "desc" },
  });
  const query = {
    search: url.searchParams.get("q")?.trim() || undefined,
    status: enumValue(Object.values(CfpSubmissionStatus), url.searchParams.get("status")),
    kind: enumValue(Object.values(CfpSubmissionKind), url.searchParams.get("type")),
    categoryId: url.searchParams.get("category") || undefined,
    assigneeId: url.searchParams.get("assignee") || undefined,
    sortBy: enumValue(
      ["submittedAt", "updatedAt", "status", "formTitle"] satisfies readonly CfpSubmissionSortKey[],
      url.searchParams.get("sort"),
    ),
    sortDirection: enumValue(["asc", "desc"] as const, url.searchParams.get("direction")),
    all: true,
  } as const;
  const repository = new CfpSubmissionRepository(client);
  const [result, options] = await Promise.all([
    repository.listForEvent(event.id, query),
    repository.getFilterOptions(event.id),
  ]);
  const table = {
    columns: view.columns,
    customLabels: Object.fromEntries(options.customColumns.map(({ id, label }) => [id, label])),
    items: result.items,
  };
  const baseName = `${event.slug}-submissions`;

  if (format === "csv") {
    return new Response(responseBody(createSubmissionCsv(table)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return new Response(responseBody(await createSubmissionXlsx(table)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
