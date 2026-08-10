import { headers } from "next/headers";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerMappingRepository } from "@/server/integrations";

interface RouteContext {
  readonly params: Promise<{ eventSlug: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { eventSlug } = await context.params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!(await isAuthorizedAdminSession(session, { slug: eventSlug }))) {
    return new Response("Not found", { status: 404 });
  }
  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
  if (!event) return new Response("Not found", { status: 404 });
  const csv = await new SpeakerMappingRepository(client).authorizedCsv(event.id);
  if (!csv) return new Response("Accelevents is not configured", { status: 404 });

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${event.slug}-accelevents-speakers.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
