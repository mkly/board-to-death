import { isPublishedScheduleFeedFormat } from "@/lib/published-embeds/feed-formats";
import { handlePublishedScheduleFeedOptions } from "@/server/published-program/public-feed";
import { handlePublishedScheduleFeedRoute } from "@/server/published-program/public-feed-route";

interface RouteContext {
  readonly params: Promise<{ readonly eventSlug: string; readonly format: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { eventSlug, format } = await context.params;
  if (!isPublishedScheduleFeedFormat(format)) {
    return new Response("Feed format not found.", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return handlePublishedScheduleFeedRoute(request, eventSlug, format);
}

export const OPTIONS = handlePublishedScheduleFeedOptions;
