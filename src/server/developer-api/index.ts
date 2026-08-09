import type { PrismaClient } from "../../generated/prisma/client.ts";
import { type ApiTokenScope, apiTokenScopes } from "./contracts.ts";
import { createHash, randomBytes } from "node:crypto";

export { type ApiTokenScope, apiTokenScopes } from "./contracts.ts";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function storedScopes(value: unknown): readonly ApiTokenScope[] {
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is ApiTokenScope => apiTokenScopes.includes(scope as ApiTokenScope));
}

export class ApiTokenService {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async issue(eventId: string, name: string, scopes: readonly ApiTokenScope[]) {
    const prefix = randomBytes(6).toString("hex");
    const secret = `btd_${prefix}_${randomBytes(24).toString("base64url")}`;
    const token = await this.#client.apiToken.create({
      data: { eventId, name, prefix, secretHash: hashSecret(secret), scopes: [...new Set(scopes)] },
    });
    return { token, secret };
  }

  async authenticate(secret: string, eventId: string, scope: ApiTokenScope) {
    const token = await this.#client.apiToken.findUnique({ where: { secretHash: hashSecret(secret) } });
    if (!token || token.eventId !== eventId || token.revokedAt || !storedScopes(token.scopes).includes(scope)) {
      return null;
    }
    await this.#client.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
    return token;
  }

  async revoke(eventId: string, tokenId: string): Promise<boolean> {
    const result = await this.#client.apiToken.updateMany({
      where: { id: tokenId, eventId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }
}

function bearerSecret(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const secret = authorization.slice("Bearer ".length).trim();
  return secret || null;
}

type PrivateResource = "sessions" | "speakers" | "submissions";

const resourceScopes = {
  sessions: "sessions:read",
  speakers: "speakers:read",
  submissions: "submissions:read",
} as const satisfies Record<PrivateResource, ApiTokenScope>;

async function resourceRows(client: PrismaClient, eventId: string, resource: PrivateResource) {
  if (resource === "sessions") {
    return client.programSession.findMany({
      where: { eventId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        updatedAt: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { versionNumber: true, title: true, description: true, durationMinutes: true, trackId: true },
        },
      },
    });
  }
  if (resource === "speakers") {
    return client.speaker.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        updatedAt: true,
        profileVersions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: {
            email: true,
            givenName: true,
            familyName: true,
            preferredName: true,
            organization: true,
            jobTitle: true,
          },
        },
      },
    });
  }
  return client.cfpSubmission.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      status: true,
      submittedAt: true,
      updatedAt: true,
      revisions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          versionNumber: true,
          answers: { orderBy: { sortOrder: "asc" }, select: { questionId: true, value: true } },
        },
      },
    },
  });
}

export async function handlePrivateApiRequest(
  request: Request,
  client: PrismaClient,
  eventId: string,
  resource: PrivateResource,
): Promise<Response> {
  const secret = bearerSecret(request);
  if (!secret) return Response.json({ error: "A bearer token is required." }, { status: 401 });
  const token = await new ApiTokenService(client).authenticate(secret, eventId, resourceScopes[resource]);
  if (!token)
    return Response.json(
      { error: "The token is invalid, revoked, out of scope, or for another event." },
      { status: 403 },
    );
  const event = await client.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return Response.json({ error: "Event not found." }, { status: 404 });
  return Response.json({ data: await resourceRows(client, eventId, resource) });
}
