import "server-only";

import { getDatabaseClient } from "@/server/database/client";
import { serverTimingHeader, withQueryMetrics } from "@/server/observability";

import { handlePublicProgramRequest, type PublicProgramResource } from "./public-api.ts";
import { PublishedProgramRepository } from "./repositories.ts";

export async function handlePublishedProgramRoute(
  request: Request,
  eventIdentifier: string,
  resource: PublicProgramResource,
): Promise<Response> {
  const repository = new PublishedProgramRepository(getDatabaseClient());
  const { result, metrics, totalDurationMs } = await withQueryMetrics(() =>
    handlePublicProgramRequest(request, eventIdentifier, resource, repository),
  );

  // The header carries only counts and durations, so it is safe on a public,
  // CORS-open response; the browser performance spec reads its numbers back.
  const headers = new Headers(result.headers);
  headers.set("Server-Timing", serverTimingHeader({ metrics, totalDurationMs }));
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
}
