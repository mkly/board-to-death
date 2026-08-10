import { headers } from "next/headers";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { createFileRequestBundle } from "@/server/files/exports";
import { createPrismaFileRequestStore } from "@/server/files/prisma-store";
import { FileRequestFileService } from "@/server/files/request-files";
import { getConfiguredFileStorage } from "@/server/infrastructure/configured-file-storage";

interface FileRequestExportContext {
  readonly params: Promise<{ readonly eventSlug: string }>;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/** Every current file collected for this event, one archive, foldered by request key. */
export async function GET(_request: Request, context: FileRequestExportContext): Promise<Response> {
  const [{ eventSlug }, session] = await Promise.all([
    context.params,
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (!(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return notFound();

  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
  if (!event) return notFound();

  const files = new FileRequestFileService({
    storage: getConfiguredFileStorage(),
    store: createPrismaFileRequestStore(client),
  });
  const collected = await files.collectForEvent(event.id);
  if (!collected.ok) return new Response(collected.error.message, { status: 500 });

  const archive = await createFileRequestBundle(collected.value);
  const body = new ArrayBuffer(archive.byteLength);
  new Uint8Array(body).set(archive);
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${event.slug}-file-requests.zip"`,
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
