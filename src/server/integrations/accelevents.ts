import type { InfrastructureFailureCode, InfrastructureResult } from "../infrastructure/index.ts";
import {
  infrastructureFailure,
  infrastructureSuccess,
  normalizeInfrastructureFailure,
} from "../infrastructure/index.ts";

export type AcceleventsOperationName =
  | "check-credentials"
  | "list-speakers"
  | "get-speaker"
  | "create-speaker"
  | "update-speaker"
  | "list-sessions"
  | "get-session"
  | "create-session"
  | "update-session";

export interface AcceleventsConnection {
  readonly remoteEventId: string;
  /** Resolved at runtime from the persisted credential reference. */
  readonly apiKey: string;
}

export interface AcceleventsCredentialCheck {
  readonly accountId: string;
  readonly remoteEventId: string;
}

export interface AcceleventsPageRequest {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface AcceleventsPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface AcceleventsSpeaker {
  readonly remoteId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface AcceleventsSpeakerInput {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface AcceleventsSession {
  readonly remoteId: string;
  readonly title: string;
  readonly description: string;
  readonly speakerRemoteIds: readonly string[];
}

export interface AcceleventsSessionInput {
  readonly title: string;
  readonly description?: string;
  readonly speakerRemoteIds?: readonly string[];
}

export interface AcceleventsAdapter {
  checkCredentials(connection: AcceleventsConnection): Promise<InfrastructureResult<AcceleventsCredentialCheck>>;
  listSpeakers(
    connection: AcceleventsConnection,
    page?: AcceleventsPageRequest,
  ): Promise<InfrastructureResult<AcceleventsPage<AcceleventsSpeaker>>>;
  getSpeaker(connection: AcceleventsConnection, remoteId: string): Promise<InfrastructureResult<AcceleventsSpeaker>>;
  createSpeaker(
    connection: AcceleventsConnection,
    input: AcceleventsSpeakerInput,
  ): Promise<InfrastructureResult<AcceleventsSpeaker>>;
  updateSpeaker(
    connection: AcceleventsConnection,
    remoteId: string,
    input: AcceleventsSpeakerInput,
  ): Promise<InfrastructureResult<AcceleventsSpeaker>>;
  listSessions(
    connection: AcceleventsConnection,
    page?: AcceleventsPageRequest,
  ): Promise<InfrastructureResult<AcceleventsPage<AcceleventsSession>>>;
  getSession(connection: AcceleventsConnection, remoteId: string): Promise<InfrastructureResult<AcceleventsSession>>;
  createSession(
    connection: AcceleventsConnection,
    input: AcceleventsSessionInput,
  ): Promise<InfrastructureResult<AcceleventsSession>>;
  updateSession(
    connection: AcceleventsConnection,
    remoteId: string,
    input: AcceleventsSessionInput,
  ): Promise<InfrastructureResult<AcceleventsSession>>;
}

type PlannedFailure =
  | { readonly kind: "failure"; readonly code: InfrastructureFailureCode; readonly retryAfterMs?: number }
  | { readonly kind: "throw"; readonly error: unknown };

export interface DeterministicAcceleventsOptions {
  readonly remoteEventId?: string;
  readonly apiKey?: string;
  readonly accountId?: string;
  readonly pageSize?: number;
  readonly speakers?: readonly AcceleventsSpeaker[];
  readonly sessions?: readonly AcceleventsSession[];
}

export interface AcceleventsRequestAudit {
  readonly operation: AcceleventsOperationName;
  readonly remoteEventId: string;
  readonly remoteId?: string;
}

function requiredText(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizedSpeaker(input: AcceleventsSpeakerInput): Omit<AcceleventsSpeaker, "remoteId"> | null {
  const email = requiredText(input.email)?.toLowerCase();
  const firstName = requiredText(input.firstName);
  const lastName = requiredText(input.lastName);
  if (!email?.includes("@") || !firstName || !lastName) return null;
  return { email, firstName, lastName };
}

function normalizedSession(input: AcceleventsSessionInput): Omit<AcceleventsSession, "remoteId"> | null {
  const title = requiredText(input.title);
  if (!title) return null;
  const speakerRemoteIds = [...(input.speakerRemoteIds ?? [])];
  if (new Set(speakerRemoteIds).size !== speakerRemoteIds.length || speakerRemoteIds.some((id) => !requiredText(id))) {
    return null;
  }
  return { title, description: input.description?.trim() ?? "", speakerRemoteIds };
}

export class DeterministicAcceleventsAdapter implements AcceleventsAdapter {
  readonly #remoteEventId: string;
  readonly #apiKey: string;
  readonly #accountId: string;
  readonly #pageSize: number;
  readonly #speakers = new Map<string, AcceleventsSpeaker>();
  readonly #sessions = new Map<string, AcceleventsSession>();
  readonly #failures = new Map<AcceleventsOperationName, PlannedFailure[]>();
  readonly #requests: AcceleventsRequestAudit[] = [];
  #speakerSequence = 0;
  #sessionSequence = 0;

  constructor(options: DeterministicAcceleventsOptions = {}) {
    this.#remoteEventId = options.remoteEventId ?? "event-test";
    this.#apiKey = options.apiKey ?? "test-api-key";
    this.#accountId = options.accountId ?? "account-test";
    this.#pageSize = options.pageSize ?? 2;
    if (!Number.isInteger(this.#pageSize) || this.#pageSize < 1) {
      throw new TypeError("pageSize must be a positive integer.");
    }
    for (const speaker of options.speakers ?? []) {
      this.#speakers.set(speaker.remoteId, structuredClone(speaker));
      this.#speakerSequence += 1;
    }
    for (const session of options.sessions ?? []) {
      this.#sessions.set(session.remoteId, structuredClone(session));
      this.#sessionSequence += 1;
    }
  }

  get requests(): readonly AcceleventsRequestAudit[] {
    return structuredClone(this.#requests);
  }

  failNext(operation: AcceleventsOperationName, code: InfrastructureFailureCode, retryAfterMs?: number): void {
    this.enqueueFailure(operation, { kind: "failure", code, retryAfterMs });
  }

  throwNext(operation: AcceleventsOperationName, error: unknown): void {
    this.enqueueFailure(operation, { kind: "throw", error });
  }

  async checkCredentials(connection: AcceleventsConnection): Promise<InfrastructureResult<AcceleventsCredentialCheck>> {
    return this.execute("check-credentials", connection, undefined, () =>
      infrastructureSuccess({ accountId: this.#accountId, remoteEventId: this.#remoteEventId }),
    );
  }

  async listSpeakers(
    connection: AcceleventsConnection,
    page: AcceleventsPageRequest = {},
  ): Promise<InfrastructureResult<AcceleventsPage<AcceleventsSpeaker>>> {
    return this.execute("list-speakers", connection, undefined, () => this.page([...this.#speakers.values()], page));
  }

  async getSpeaker(
    connection: AcceleventsConnection,
    remoteId: string,
  ): Promise<InfrastructureResult<AcceleventsSpeaker>> {
    return this.execute("get-speaker", connection, remoteId, () => this.lookup(this.#speakers, remoteId));
  }

  async createSpeaker(
    connection: AcceleventsConnection,
    input: AcceleventsSpeakerInput,
  ): Promise<InfrastructureResult<AcceleventsSpeaker>> {
    return this.execute("create-speaker", connection, undefined, () => {
      const speaker = normalizedSpeaker(input);
      if (!speaker) return infrastructureFailure("accelevents", "invalid-input");
      if ([...this.#speakers.values()].some(({ email }) => email === speaker.email)) {
        return infrastructureFailure("accelevents", "conflict");
      }
      this.#speakerSequence += 1;
      const created = { remoteId: this.remoteId("speaker", this.#speakerSequence), ...speaker };
      this.#speakers.set(created.remoteId, created);
      return infrastructureSuccess(structuredClone(created));
    });
  }

  async updateSpeaker(
    connection: AcceleventsConnection,
    remoteId: string,
    input: AcceleventsSpeakerInput,
  ): Promise<InfrastructureResult<AcceleventsSpeaker>> {
    return this.execute("update-speaker", connection, remoteId, () => {
      if (!this.#speakers.has(remoteId)) return infrastructureFailure("accelevents", "not-found");
      const speaker = normalizedSpeaker(input);
      if (!speaker) return infrastructureFailure("accelevents", "invalid-input");
      const updated = { remoteId, ...speaker };
      this.#speakers.set(remoteId, updated);
      return infrastructureSuccess(structuredClone(updated));
    });
  }

  async listSessions(
    connection: AcceleventsConnection,
    page: AcceleventsPageRequest = {},
  ): Promise<InfrastructureResult<AcceleventsPage<AcceleventsSession>>> {
    return this.execute("list-sessions", connection, undefined, () => this.page([...this.#sessions.values()], page));
  }

  async getSession(
    connection: AcceleventsConnection,
    remoteId: string,
  ): Promise<InfrastructureResult<AcceleventsSession>> {
    return this.execute("get-session", connection, remoteId, () => this.lookup(this.#sessions, remoteId));
  }

  async createSession(
    connection: AcceleventsConnection,
    input: AcceleventsSessionInput,
  ): Promise<InfrastructureResult<AcceleventsSession>> {
    return this.execute("create-session", connection, undefined, () => {
      const session = normalizedSession(input);
      if (!session || session.speakerRemoteIds.some((id) => !this.#speakers.has(id))) {
        return infrastructureFailure("accelevents", "invalid-input");
      }
      this.#sessionSequence += 1;
      const created = { remoteId: this.remoteId("session", this.#sessionSequence), ...session };
      this.#sessions.set(created.remoteId, created);
      return infrastructureSuccess(structuredClone(created));
    });
  }

  async updateSession(
    connection: AcceleventsConnection,
    remoteId: string,
    input: AcceleventsSessionInput,
  ): Promise<InfrastructureResult<AcceleventsSession>> {
    return this.execute("update-session", connection, remoteId, () => {
      if (!this.#sessions.has(remoteId)) return infrastructureFailure("accelevents", "not-found");
      const session = normalizedSession(input);
      if (!session || session.speakerRemoteIds.some((id) => !this.#speakers.has(id))) {
        return infrastructureFailure("accelevents", "invalid-input");
      }
      const updated = { remoteId, ...session };
      this.#sessions.set(remoteId, updated);
      return infrastructureSuccess(structuredClone(updated));
    });
  }

  private enqueueFailure(operation: AcceleventsOperationName, failure: PlannedFailure): void {
    const queue = this.#failures.get(operation) ?? [];
    queue.push(failure);
    this.#failures.set(operation, queue);
  }

  private execute<T>(
    operation: AcceleventsOperationName,
    connection: AcceleventsConnection,
    remoteId: string | undefined,
    work: () => InfrastructureResult<T>,
  ): InfrastructureResult<T> {
    this.#requests.push({ operation, remoteEventId: connection.remoteEventId, ...(remoteId ? { remoteId } : {}) });
    const planned = this.#failures.get(operation)?.shift();
    if (planned?.kind === "failure") {
      return infrastructureFailure("accelevents", planned.code, planned.retryAfterMs);
    }
    if (planned?.kind === "throw") {
      return normalizeInfrastructureFailure("accelevents", planned.error);
    }
    if (connection.apiKey !== this.#apiKey) return infrastructureFailure("accelevents", "unauthorized");
    if (connection.remoteEventId !== this.#remoteEventId) return infrastructureFailure("accelevents", "not-found");
    return work();
  }

  private lookup<T>(records: ReadonlyMap<string, T>, remoteId: string): InfrastructureResult<T> {
    const record = records.get(remoteId);
    return record ? infrastructureSuccess(structuredClone(record)) : infrastructureFailure("accelevents", "not-found");
  }

  private page<T>(records: readonly T[], request: AcceleventsPageRequest): InfrastructureResult<AcceleventsPage<T>> {
    const limit = request.limit ?? this.#pageSize;
    const match = request.cursor?.match(/^cursor-(\d+)$/);
    const offset = request.cursor === undefined ? 0 : Number(match?.[1]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      return infrastructureFailure("accelevents", "invalid-input");
    }
    const items = records.slice(offset, offset + limit).map((record) => structuredClone(record));
    const nextOffset = offset + items.length;
    return infrastructureSuccess({ items, nextCursor: nextOffset < records.length ? `cursor-${nextOffset}` : null });
  }

  private remoteId(resource: "speaker" | "session", sequence: number): string {
    return `${resource}-${String(sequence).padStart(4, "0")}`;
  }
}
