import type { PrincipalProvider } from "../authorization/scoped-operations.ts";
import { EventScopedAuthorizer } from "../authorization/scoped-operations.ts";
import type { PersistedPublishedProgramVersion, PublishedProgramRepository } from "./repositories.ts";

export interface PublishedProgramPushRequest {
  readonly eventId: string;
  readonly publishedVersion: number;
  readonly idempotencyKey: string;
}

export type PublishedProgramPushQueue = (request: PublishedProgramPushRequest) => Promise<void>;

export class PublishedProgramOperations {
  private readonly repository: PublishedProgramRepository;
  private readonly authorizer: EventScopedAuthorizer;
  private readonly queuePush?: PublishedProgramPushQueue;

  constructor(
    repository: PublishedProgramRepository,
    getPrincipal: PrincipalProvider,
    queuePush?: PublishedProgramPushQueue,
  ) {
    this.repository = repository;
    this.authorizer = new EventScopedAuthorizer(getPrincipal);
    this.queuePush = queuePush;
  }

  async publish(eventId: string, expectedVersion = 0): Promise<PersistedPublishedProgramVersion> {
    const scope = await this.authorizer.requireOrganizer(eventId, "write");
    const published = await this.repository.publish({ eventId, expectedVersion, actorPrincipalId: scope.principalId });
    await this.enqueuePush(published);
    return published;
  }

  async republish(eventId: string, expectedVersion: number): Promise<PersistedPublishedProgramVersion> {
    const scope = await this.authorizer.requireOrganizer(eventId, "write");
    const published = await this.repository.republish({
      eventId,
      expectedVersion,
      actorPrincipalId: scope.principalId,
    });
    await this.enqueuePush(published);
    return published;
  }

  async unpublish(eventId: string, expectedVersion: number): Promise<PersistedPublishedProgramVersion> {
    const scope = await this.authorizer.requireOrganizer(eventId, "write");
    return this.repository.unpublish({ eventId, expectedVersion, actorPrincipalId: scope.principalId });
  }

  private async enqueuePush(published: PersistedPublishedProgramVersion): Promise<void> {
    await this.queuePush?.({
      eventId: published.eventId,
      publishedVersion: published.versionNumber,
      idempotencyKey: `published-program:${published.versionNumber}`,
    });
  }
}
