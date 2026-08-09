import "server-only";

import { getDatabaseClient } from "@/server/database/client";

import { handlePrivateApiRequest } from ".";

export type PrivateApiResource = "sessions" | "speakers" | "submissions";

export function privateApiRoute(request: Request, eventId: string, resource: PrivateApiResource): Promise<Response> {
  return handlePrivateApiRequest(request, getDatabaseClient(), eventId, resource);
}
