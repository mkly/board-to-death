import "server-only";

import { getDatabaseClient } from "@/server/database/client";

import { handlePublicProgramRequest, type PublicProgramResource } from "./public-api.ts";
import { PublishedProgramRepository } from "./repositories.ts";

export async function handlePublishedProgramRoute(
  request: Request,
  eventIdentifier: string,
  resource: PublicProgramResource,
): Promise<Response> {
  const repository = new PublishedProgramRepository(getDatabaseClient());
  return handlePublicProgramRequest(request, eventIdentifier, resource, repository);
}
