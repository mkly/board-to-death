import { getRequestAuthorization } from "@/server/authorization/request-context";
import { getDatabaseClient } from "@/server/database/client";
import { getConfiguredFileStorage } from "@/server/infrastructure/configured-file-storage";

import { avatarObjectKey, avatarUrl, isAvatarFileId } from "../../_lib/avatar";

interface RouteContext {
  readonly params: Promise<{ readonly fileId: string }>;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { fileId } = await context.params;
  if (!isAvatarFileId(fileId)) return notFound();

  const authorization = await getRequestAuthorization();
  if (!authorization) return notFound();
  const userId = authorization.session.user.id;

  const user = await getDatabaseClient().user.findUnique({ where: { id: userId }, select: { image: true } });
  if (user?.image !== avatarUrl(fileId)) return notFound();

  const stored = await getConfiguredFileStorage().get(avatarObjectKey(userId, fileId));
  if (!stored.ok) return notFound();

  const { metadata, bytes } = stored.value;
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, {
    headers: {
      // Each upload mints a new fileId, so the URL's content never changes.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": metadata.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
