import type { PrincipalProvider } from "../authorization/scoped-operations.ts";
import { EventScopedAuthorizer } from "../authorization/scoped-operations.ts";
import type { PersistedPublishedProgramVersion, PublishedProgramRepository } from "./repositories.ts";

export class PublishedProgramOperations {
  private readonly repository: PublishedProgramRepository;
  private readonly authorizer: EventScopedAuthorizer;

  constructor(repository: PublishedProgramRepository, getPrincipal: PrincipalProvider) {
    this.repository = repository;
    this.authorizer = new EventScopedAuthorizer(getPrincipal);
  }

  async publish(eventId: string, expectedVersion = 0): Promise<PersistedPublishedProgramVersion> {
    const scope = await this.authorizer.requireOrganizer(eventId, "write");
    return this.repository.publish({ eventId, expectedVersion, actorPrincipalId: scope.principalId });
  }

  async republish(eventId: string, expectedVersion: number): Promise<PersistedPublishedProgramVersion> {
    const scope = await this.authorizer.requireOrganizer(eventId, "write");
    return this.repository.republish({ eventId, expectedVersion, actorPrincipalId: scope.principalId });
  }

  async unpublish(eventId: string, expectedVersion: number): Promise<PersistedPublishedProgramVersion> {
    const scope = await this.authorizer.requireOrganizer(eventId, "write");
    return this.repository.unpublish({ eventId, expectedVersion, actorPrincipalId: scope.principalId });
  }
}
