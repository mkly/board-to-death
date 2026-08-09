import { headers } from "next/headers";

import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { loadSessionPreviewCsv, sessionPreviewCsv } from "@/server/integrations";

interface CsvRouteContext {
  readonly params: Promise<{ eventSlug: string }>;
}

export async function GET(_request: Request, { params }: CsvRouteContext): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) return new Response("Not found", { status: 404 });

  const { eventSlug } = await params;
  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
  if (!event) return new Response("Not found", { status: 404 });
  const loaded = await loadSessionPreviewCsv(client, event.id);
  if (!loaded.configured || !loaded.publishedVersion) return new Response("Not found", { status: 404 });

  return new Response(sessionPreviewCsv(loaded.records), {
    headers: {
      "content-disposition": `attachment; filename="${event.slug}-accelevents-session-preview.csv"`,
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
