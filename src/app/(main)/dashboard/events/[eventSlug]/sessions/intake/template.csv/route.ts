import { headers } from "next/headers";

import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { adminIntakeCsvTemplate } from "@/server/intake/csv";

interface TemplateRouteContext {
  readonly params: Promise<{ eventSlug: string }>;
}

export async function GET(_request: Request, { params }: TemplateRouteContext): Promise<Response> {
  const [{ eventSlug }, session] = await Promise.all([params, auth.api.getSession({ headers: await headers() })]);
  if (!session || !isAllowedAdminEmail(session.user.email)) return new Response("Not found", { status: 404 });
  const event = await getDatabaseClient().event.findUnique({ where: { slug: eventSlug }, select: { id: true } });
  if (!event) return new Response("Not found", { status: 404 });
  return new Response(adminIntakeCsvTemplate(), {
    headers: {
      "Content-Disposition": 'attachment; filename="admin-intake-template.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
