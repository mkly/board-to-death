import { headers } from "next/headers";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getBrandingImageResponse } from "@/server/branding-images";
import { getDatabaseClient } from "@/server/database/client";

interface BrandingRouteContext {
  readonly params: Promise<{ readonly eventId: string; readonly asset: string }>;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: BrandingRouteContext): Promise<Response> {
  const [{ eventId, asset }, session] = await Promise.all([
    context.params,
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (!(await isAuthorizedAdminSession(session, { id: eventId }))) return notFound();

  const event = await getDatabaseClient().event.findUnique({
    where: { id: eventId },
    select: { logoObjectKey: true, backgroundObjectKey: true },
  });
  let key: string | null | undefined;
  if (asset === "logo") key = event?.logoObjectKey;
  if (asset === "background") key = event?.backgroundObjectKey;
  if (!key) return notFound();

  return (await getBrandingImageResponse(key)) ?? notFound();
}
