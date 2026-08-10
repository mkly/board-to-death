import {
  EventMembershipRole,
  MembershipStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import type { AuthenticatedPrincipal, EventRole } from "./policy";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export interface PrincipalOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface MembershipPrincipal {
  readonly principal: AuthenticatedPrincipal;
  readonly organizations: readonly PrincipalOrganization[];
}

function eventRole(role: EventMembershipRole): EventRole {
  switch (role) {
    case EventMembershipRole.ORGANIZER_ADMIN:
      return "organizer-admin";
    case EventMembershipRole.REVIEWER:
      return "reviewer";
    case EventMembershipRole.APPLICANT:
      return "applicant";
    case EventMembershipRole.SPEAKER:
      return "speaker";
  }
}

export async function resolveMembershipPrincipal(client: DatabaseClient, userId: string): Promise<MembershipPrincipal> {
  const organizationMemberships = await client.organizationMember.findMany({
    where: { userId, status: MembershipStatus.ACTIVE },
    orderBy: [{ createdAt: "asc" }, { orgId: "asc" }],
    select: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          events: { select: { id: true } },
        },
      },
    },
  });
  const eventMemberships = await client.eventMembership.findMany({
    where: { userId, status: MembershipStatus.ACTIVE },
    select: { eventId: true, roles: true },
  });

  const rolesByEvent = new Map<string, Set<EventRole>>();
  const addRole = (eventId: string, role: EventRole) => {
    const roles = rolesByEvent.get(eventId) ?? new Set<EventRole>();
    roles.add(role);
    rolesByEvent.set(eventId, roles);
  };

  for (const { organization } of organizationMemberships) {
    for (const event of organization.events) addRole(event.id, "organizer-admin");
  }
  for (const membership of eventMemberships) {
    for (const role of membership.roles) addRole(membership.eventId, eventRole(role));
  }

  return {
    principal: {
      id: userId,
      memberships: [...rolesByEvent].map(([eventId, roles]) => ({ eventId, roles: [...roles] })),
    },
    organizations: organizationMemberships.map(
      ({ organization: { events: _events, ...organization } }) => organization,
    ),
  };
}
