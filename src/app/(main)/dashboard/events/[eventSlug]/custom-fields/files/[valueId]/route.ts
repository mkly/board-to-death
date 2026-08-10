import { headers } from "next/headers";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CustomFieldFileService, createPrismaCustomFieldFileStore } from "@/server/custom-fields/files";
import { getDatabaseClient } from "@/server/database/client";
import { createFileStorage } from "@/server/infrastructure";

interface CustomFieldFileRouteContext {
  readonly params: Promise<{ readonly eventSlug: string; readonly valueId: string }>;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: CustomFieldFileRouteContext): Promise<Response> {
  const [{ eventSlug, valueId }, session] = await Promise.all([
    context.params,
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (!isAuthorizedAdminSession(session)) return notFound();

  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true } });
  if (!event) return notFound();

  const file = await new CustomFieldFileService({
    storage: createFileStorage({ driver: "local", rootDirectory: getRuntimeConfig().server.FILE_STORAGE_PATH }),
    store: createPrismaCustomFieldFileStore(client),
  }).download(event.id, valueId);
  if (!file) return notFound();

  const body = new ArrayBuffer(file.bytes.byteLength);
  new Uint8Array(body).set(file.bytes);
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": file.contentDisposition,
      "Content-Type": file.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
