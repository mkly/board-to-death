import {
  type AuthenticatedPrincipal,
  AuthorizationError,
  type AuthorizedEventScope,
  authorizeEventResource,
  type EventResourceAction,
  type EventResourceKind,
  eventRoles,
  requireAuthenticatedPrincipal,
} from "./policy";

export type PrincipalProvider = () => Promise<AuthenticatedPrincipal | null>;

export interface EventOwnedResourceAuthorization {
  readonly eventId: string;
  readonly ownerPrincipalIds?: readonly string[];
  readonly assignedReviewerIds?: readonly string[];
}

export type EventOwnedResourceLoader = (
  eventId: string,
  resourceId: string,
) => Promise<EventOwnedResourceAuthorization | null>;

export class EventScopedAuthorizer {
  private readonly getPrincipal: PrincipalProvider;

  constructor(getPrincipal: PrincipalProvider) {
    this.getPrincipal = getPrincipal;
  }

  async requireOrganizer(eventId: string, action: EventResourceAction): Promise<AuthorizedEventScope> {
    const principal = requireAuthenticatedPrincipal(await this.getPrincipal());
    return authorizeEventResource(principal, { eventId, kind: "event-program", action });
  }

  async requireResource(
    eventId: string,
    resourceId: string,
    kind: Exclude<EventResourceKind, "event-program">,
    action: EventResourceAction,
    loadResource: EventOwnedResourceLoader,
  ): Promise<AuthorizedEventScope> {
    const principal = requireAuthenticatedPrincipal(await this.getPrincipal());

    if (eventRoles(principal, eventId).length === 0) {
      throw new AuthorizationError("not-found");
    }

    const resource = await loadResource(eventId, resourceId);
    if (!resource || resource.eventId !== eventId) {
      throw new AuthorizationError("not-found");
    }

    return authorizeEventResource(principal, {
      eventId,
      kind,
      action,
      ownerPrincipalIds: resource.ownerPrincipalIds,
      assignedReviewerIds: resource.assignedReviewerIds,
    });
  }
}
