import { getBrandingImageResponse } from "@/server/branding-images";

import { getPortalConfiguration } from "../../_lib/portal-session";

interface PortalBrandingRouteContext {
  readonly params: Promise<{ readonly eventSlug: string; readonly asset: string }>;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: PortalBrandingRouteContext): Promise<Response> {
  const { eventSlug, asset } = await context.params;
  const portal = await getPortalConfiguration(eventSlug);
  let key: string | undefined;
  if (asset === "logo") key = portal.logoObjectKey;
  if (asset === "background") key = portal.backgroundObjectKey;
  if (!key || key.startsWith("/")) return notFound();
  return (await getBrandingImageResponse(key)) ?? notFound();
}
