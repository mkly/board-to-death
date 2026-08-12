import { headers } from "next/headers";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getBrandingImageResponse } from "@/server/branding-images";
import { getDatabaseClient } from "@/server/database/client";

interface PortalBrandingRouteContext {
  readonly params: Promise<{ readonly eventSlug: string; readonly portalId: string; readonly asset: string }>;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: PortalBrandingRouteContext): Promise<Response> {
  const [{ eventSlug, portalId, asset }, session] = await Promise.all([
    context.params,
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (!(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return notFound();

  const portal = await getDatabaseClient().participantPortal.findFirst({
    where: { id: portalId, event: { slug: eventSlug } },
    select: { logoObjectKey: true, backgroundObjectKey: true },
  });
  let key: string | null | undefined;
  if (asset === "logo") key = portal?.logoObjectKey;
  if (asset === "background") key = portal?.backgroundObjectKey;
  if (!key || key.startsWith("/")) return notFound();
  return (await getBrandingImageResponse(key)) ?? notFound();
}
