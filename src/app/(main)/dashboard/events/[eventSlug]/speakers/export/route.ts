import { headers } from "next/headers";

import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import {
  createSpeakerTaskMatrixCsv,
  parseSpeakerTaskMatrixFilters,
  SpeakerTaskMatrixRepository,
} from "@/server/speakers";

interface ExportRouteContext {
  readonly params: Promise<{ eventSlug: string }>;
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function GET(request: Request, { params }: ExportRouteContext): Promise<Response> {
  const [{ eventSlug }, session] = await Promise.all([params, auth.api.getSession({ headers: await headers() })]);
  if (!session || !isAllowedAdminEmail(session.user.email)) return new Response("Not found", { status: 404 });

  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true, timezone: true },
  });
  if (!event) return new Response("Not found", { status: 404 });

  const filters = parseSpeakerTaskMatrixFilters(new URL(request.url).searchParams);
  const result = await new SpeakerTaskMatrixRepository(client).list(event.id, event.timezone, filters);
  return new Response(responseBody(createSpeakerTaskMatrixCsv(result.rows, event.timezone)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}-speaker-tasks.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
