import "server-only";

import type { PublishedScheduleFeedFormat } from "@/lib/published-embeds/feed-formats";
import { getDatabaseClient } from "@/server/database/client";
import { serverTimingHeader, withQueryMetrics } from "@/server/observability";

import { handlePublishedScheduleFeedRequest } from "./public-feed.ts";
import { PublishedProgramRepository } from "./repositories.ts";

export async function handlePublishedScheduleFeedRoute(
  request: Request,
  eventIdentifier: string,
  format: PublishedScheduleFeedFormat,
): Promise<Response> {
  const repository = new PublishedProgramRepository(getDatabaseClient());
  const { result, metrics, totalDurationMs } = await withQueryMetrics(() =>
    handlePublishedScheduleFeedRequest(request, eventIdentifier, format, repository),
  );
  const headers = new Headers(result.headers);
  headers.set("Server-Timing", serverTimingHeader({ metrics, totalDurationMs }));
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
}
