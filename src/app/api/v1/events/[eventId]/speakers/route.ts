import { handlePublicProgramOptions } from "@/server/published-program";
import { handlePublishedProgramRoute } from "@/server/published-program/public-route";

interface RouteContext {
  readonly params: Promise<{ readonly eventId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { eventId } = await context.params;
  return handlePublishedProgramRoute(request, eventId, "speakers");
}

export const OPTIONS = handlePublicProgramOptions;
