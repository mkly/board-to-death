export type EventRole = "organizer-admin" | "reviewer" | "applicant" | "speaker";

export interface EventMembership {
  readonly eventId: string;
  readonly roles: readonly EventRole[];
}

export interface AuthenticatedPrincipal {
  readonly id: string;
  readonly memberships: readonly EventMembership[];
}

export type EventResourceKind = "event-program" | "review" | "profile" | "submission" | "session" | "file" | "task";
export type EventResourceAction = "read" | "write";

export interface EventResourceAuthorization {
  readonly eventId: string;
  readonly kind: EventResourceKind;
  readonly action: EventResourceAction;
  readonly ownerPrincipalIds?: readonly string[];
  readonly assignedReviewerIds?: readonly string[];
}

export interface AuthorizedEventScope {
  readonly eventId: string;
  readonly principalId: string;
  readonly roles: readonly EventRole[];
}

export type AuthorizationErrorCode = "unauthenticated" | "not-found";

export class AuthorizationError extends Error {
  readonly code: AuthorizationErrorCode;

  constructor(code: AuthorizationErrorCode) {
    super(code === "unauthenticated" ? "Authentication is required." : "The requested resource was not found.");
    this.name = "AuthorizationError";
    this.code = code;
  }
}

const PERSONAL_RESOURCE_KINDS: ReadonlySet<EventResourceKind> = new Set([
  "profile",
  "submission",
  "session",
  "file",
  "task",
]);

export function requireAuthenticatedPrincipal(
  principal: AuthenticatedPrincipal | null | undefined,
): AuthenticatedPrincipal {
  if (!principal) {
    throw new AuthorizationError("unauthenticated");
  }
  return principal;
}

export function eventRoles(principal: AuthenticatedPrincipal, eventId: string): readonly EventRole[] {
  return [
    ...new Set(
      principal.memberships.filter((membership) => membership.eventId === eventId).flatMap(({ roles }) => roles),
    ),
  ];
}

export function organizerEventIds(principal: AuthenticatedPrincipal): readonly string[] {
  return [
    ...new Set(
      principal.memberships.filter(({ roles }) => roles.includes("organizer-admin")).map(({ eventId }) => eventId),
    ),
  ];
}

export function authorizeEventResource(
  principal: AuthenticatedPrincipal,
  resource: EventResourceAuthorization,
): AuthorizedEventScope {
  const roles = eventRoles(principal, resource.eventId);
  const isOrganizer = roles.includes("organizer-admin");
  const isAssignedReviewer =
    resource.kind === "review" &&
    roles.includes("reviewer") &&
    resource.assignedReviewerIds?.includes(principal.id) === true;
  const ownsPersonalResource =
    PERSONAL_RESOURCE_KINDS.has(resource.kind) &&
    (roles.includes("applicant") || roles.includes("speaker")) &&
    resource.ownerPrincipalIds?.includes(principal.id) === true;

  if (!isOrganizer && !isAssignedReviewer && !ownsPersonalResource) {
    throw new AuthorizationError("not-found");
  }

  return { eventId: resource.eventId, principalId: principal.id, roles };
}
