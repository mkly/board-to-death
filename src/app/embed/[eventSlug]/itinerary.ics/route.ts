import { getDatabaseClient } from "@/server/database/client";
import { PublishedProgramRepository } from "@/server/published-program";
import { handlePublishedItineraryCalendarRequest } from "@/server/published-program/itinerary-calendar";
import { handlePublishedScheduleFeedRoute } from "@/server/published-program/public-feed-route";

interface RouteContext {
  readonly params: Promise<{ readonly eventSlug: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { eventSlug } = await context.params;
  return handlePublishedScheduleFeedRoute(request, eventSlug, "ical");
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { eventSlug } = await context.params;
  return handlePublishedItineraryCalendarRequest(
    request,
    eventSlug,
    new PublishedProgramRepository(getDatabaseClient()),
  );
}
