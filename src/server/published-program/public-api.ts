import type {
  PublicPublishedProgramLookup,
  PublishedProgramPlacementSnapshot,
  PublishedProgramSessionSnapshot,
  PublishedProgramSnapshot,
  PublishedProgramSpeakerSnapshot,
} from "./repositories.ts";

export const PUBLIC_PROGRAM_RESOURCES = ["sessions", "speakers", "agenda"] as const;

export type PublicProgramResource = (typeof PUBLIC_PROGRAM_RESOURCES)[number];

export interface PublicProgramReader {
  findPublic(identifier: string): Promise<PublicPublishedProgramLookup>;
}

interface Pagination {
  readonly page: number;
  readonly pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match, X-API-Key",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "86400",
} as const;

function jsonResponse(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function parsePositiveInteger(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePagination(url: URL): Pagination | null {
  if (url.searchParams.getAll("page").length > 1 || url.searchParams.getAll("pageSize").length > 1) return null;
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const pageSize = parsePositiveInteger(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE);
  if (page === null || pageSize === null || pageSize > MAX_PAGE_SIZE) return null;
  return { page, pageSize };
}

function publicSpeaker(speaker: PublishedProgramSpeakerSnapshot) {
  return {
    id: speaker.id,
    givenName: speaker.givenName,
    familyName: speaker.familyName,
    preferredName: speaker.preferredName,
    pronouns: speaker.pronouns,
    organization: speaker.organization,
    jobTitle: speaker.jobTitle,
    biography: speaker.biography,
    websiteUrl: speaker.websiteUrl,
  };
}

function dataForResource(snapshot: PublishedProgramSnapshot, resource: PublicProgramResource) {
  const resources: {
    readonly agenda: readonly PublishedProgramPlacementSnapshot[];
    readonly sessions: readonly PublishedProgramSessionSnapshot[];
    readonly speakers: readonly ReturnType<typeof publicSpeaker>[];
  } = {
    agenda: snapshot.placements,
    sessions: snapshot.sessions,
    speakers: snapshot.speakers.map(publicSpeaker),
  };
  return resources[resource];
}

function pageUrl(requestUrl: URL, pagination: Pagination, page: number): string {
  const url = new URL(requestUrl);
  url.search = "";
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pagination.pageSize));
  return url.toString();
}

function responseHeaders(etag: string, publishedAt: Date): HeadersInit {
  return {
    ...CORS_HEADERS,
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    ETag: etag,
    "Last-Modified": publishedAt.toUTCString(),
  };
}

export async function handlePublicProgramRequest(
  request: Request,
  identifier: string,
  resource: PublicProgramResource,
  reader: PublicProgramReader,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const pagination = parsePagination(requestUrl);
  if (!pagination) {
    return errorResponse(
      400,
      "INVALID_PAGINATION",
      `page and pageSize must be positive integers, and pageSize cannot exceed ${MAX_PAGE_SIZE}.`,
    );
  }

  const result = await reader.findPublic(identifier);
  if (result.status === "event-not-found") {
    return errorResponse(404, "EVENT_NOT_FOUND", "The requested event does not exist.");
  }
  if (result.status === "not-published") {
    return errorResponse(404, "PROGRAM_NOT_PUBLISHED", "The event does not have a published program.");
  }
  if (result.status === "unpublished") {
    return errorResponse(410, "PROGRAM_UNPUBLISHED", "The event program is not currently published.");
  }

  const { snapshot } = result.version;
  const allData = dataForResource(snapshot, resource);
  const start = (pagination.page - 1) * pagination.pageSize;
  const data = allData.slice(start, start + pagination.pageSize);
  const totalPages = Math.ceil(allData.length / pagination.pageSize);
  const etag = `"${snapshot.event.id}:v${result.version.versionNumber}:${resource}:p${pagination.page}:s${pagination.pageSize}"`;
  const headers = responseHeaders(etag, result.version.createdAt);

  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  return Response.json(
    {
      data,
      meta: {
        event: {
          id: snapshot.event.id,
          name: snapshot.event.name,
          slug: snapshot.event.slug,
          timezone: snapshot.event.timezone,
        },
        publication: {
          version: result.version.versionNumber,
          publishedAt: result.version.createdAt.toISOString(),
        },
        pagination: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: allData.length,
          totalPages,
        },
      },
      links: {
        self: pageUrl(requestUrl, pagination, pagination.page),
        next: pagination.page < totalPages ? pageUrl(requestUrl, pagination, pagination.page + 1) : null,
        previous: pagination.page > 1 ? pageUrl(requestUrl, pagination, pagination.page - 1) : null,
      },
    },
    { headers },
  );
}

export function handlePublicProgramOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
