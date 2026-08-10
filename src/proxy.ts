import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSessionCookie } from "better-auth/cookies";

import { MembershipStatus } from "@/generated/prisma/client";
import { auth } from "@/server/auth/auth";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/server/authorization/cookies";
import { getDatabaseClient } from "@/server/database/client";

function dashboardEventSlug(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/events\/([^/]+)(?:\/|$)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const sessionToken = getSessionCookie(request);
  if (!sessionToken) {
    const signInUrl = new URL("/auth/v1/login", request.url);
    signInUrl.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  const eventSlug = dashboardEventSlug(request.nextUrl.pathname);
  if (!eventSlug) return NextResponse.next();

  const session = await auth.api.getSession({ headers: request.headers });
  // The proxy's cookie check remains optimistic. The dashboard loader performs the authoritative
  // redirect and cookie cleanup for invalid or expired sessions.
  if (!session) return NextResponse.next();

  const client = getDatabaseClient();
  const [event, organizationMemberships] = await Promise.all([
    client.event.findUnique({
      where: { slug: eventSlug },
      select: {
        orgId: true,
        memberships: {
          where: { userId: session.user.id, status: MembershipStatus.ACTIVE },
          select: { id: true },
          take: 1,
        },
      },
    }),
    client.organizationMember.findMany({
      where: { userId: session.user.id, status: MembershipStatus.ACTIVE },
      orderBy: [{ createdAt: "asc" }, { orgId: "asc" }],
      select: { orgId: true },
    }),
  ]);
  if (!event) return NextResponse.next();

  const requestedOrganizationId = request.cookies.get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const activeOrganizationId =
    organizationMemberships.find(({ orgId }) => orgId === requestedOrganizationId)?.orgId ??
    organizationMemberships[0]?.orgId;
  const isAuthorizedThroughActiveOrganization = activeOrganizationId === event.orgId;
  const isAuthorizedThroughEventInvitation = event.memberships.length > 0;

  // Organization members reach only the active organization's events. Event-only invitees may also
  // reach the exact events to which they were invited, without gaining access to sibling events.
  if (!isAuthorizedThroughActiveOrganization && !isAuthorizedThroughEventInvitation) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
