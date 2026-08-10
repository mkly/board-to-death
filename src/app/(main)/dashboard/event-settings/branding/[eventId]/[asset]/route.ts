import { headers } from "next/headers";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { getConfiguredFileStorage } from "@/server/infrastructure/configured-file-storage";

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

  const stored = await getConfiguredFileStorage().get(key);
  if (!stored.ok || !stored.value.metadata.contentType.startsWith("image/")) return notFound();

  const body = new ArrayBuffer(stored.value.bytes.byteLength);
  new Uint8Array(body).set(stored.value.bytes);
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Content-Type": stored.value.metadata.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
