import type {
  AcceleventsOperation,
  AcceleventsService,
  ClockService,
  EmailDelivery,
  EmailMessage,
  EmailService,
  FileStorageService,
  FileWrite,
  InfrastructureFailureCode,
  InfrastructureResult,
  InfrastructureServiceName,
  PersistenceService,
  StoredFile,
  StoredFileMetadata,
  TokenGeneratorService,
  TokenRequest,
} from "./contracts.ts";
import {
  captureInfrastructureResult,
  infrastructureFailure,
  infrastructureSuccess,
  normalizeInfrastructureFailure,
} from "./results.ts";

type PlannedFailure =
  | { readonly kind: "failure"; readonly code: InfrastructureFailureCode; readonly retryAfterMs?: number }
  | { readonly kind: "error"; readonly error: unknown };

class DeterministicFailurePlan {
  readonly #failures: PlannedFailure[] = [];

  failNext(code: InfrastructureFailureCode, retryAfterMs?: number): void {
    this.#failures.push({ kind: "failure", code, retryAfterMs });
  }

  throwNext(error: unknown): void {
    this.#failures.push({ kind: "error", error });
  }

  consume<T>(service: InfrastructureServiceName): InfrastructureResult<T> | undefined {
    const planned = this.#failures.shift();
    if (!planned) {
      return undefined;
    }

    if (planned.kind === "failure") {
      return infrastructureFailure(service, planned.code, planned.retryAfterMs);
    }

    return normalizeInfrastructureFailure(service, planned.error);
  }
}

export class DeterministicClock implements ClockService {
  #currentTimeMs: number;

  constructor(now: Date | string | number = "2026-01-01T00:00:00.000Z") {
    const currentTimeMs = new Date(now).getTime();
    if (!Number.isFinite(currentTimeMs)) {
      throw new TypeError("DeterministicClock requires a valid initial date.");
    }
    this.#currentTimeMs = currentTimeMs;
  }

  now(): Date {
    return new Date(this.#currentTimeMs);
  }

  advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new TypeError("DeterministicClock can only advance by a non-negative duration.");
    }
    this.#currentTimeMs += milliseconds;
  }
}

export class DeterministicPersistence<TRepositories extends object> implements PersistenceService<TRepositories> {
  readonly #failures = new DeterministicFailurePlan();
  readonly repositories: TRepositories;
  #transactionCount = 0;

  constructor(repositories: TRepositories) {
    this.repositories = repositories;
  }

  get transactionCount(): number {
    return this.#transactionCount;
  }

  failNext(code: InfrastructureFailureCode, retryAfterMs?: number): void {
    this.#failures.failNext(code, retryAfterMs);
  }

  throwNext(error: unknown): void {
    this.#failures.throwNext(error);
  }

  async transaction<T>(work: (repositories: TRepositories) => T | Promise<T>): Promise<InfrastructureResult<T>> {
    const failure = this.#failures.consume<T>("persistence");
    if (failure) {
      return failure;
    }

    this.#transactionCount += 1;
    return captureInfrastructureResult("persistence", () => work(this.repositories));
  }
}

export class DeterministicEmailService implements EmailService {
  readonly #clock: ClockService;
  readonly #failures = new DeterministicFailurePlan();
  readonly #messages: EmailMessage[] = [];

  constructor(clock: ClockService) {
    this.#clock = clock;
  }

  get sentMessages(): readonly EmailMessage[] {
    return structuredClone(this.#messages);
  }

  failNext(code: InfrastructureFailureCode, retryAfterMs?: number): void {
    this.#failures.failNext(code, retryAfterMs);
  }

  throwNext(error: unknown): void {
    this.#failures.throwNext(error);
  }

  async send(message: EmailMessage): Promise<InfrastructureResult<EmailDelivery>> {
    const failure = this.#failures.consume<EmailDelivery>("email");
    if (failure) {
      return failure;
    }

    if (message.to.length === 0 || message.subject.trim() === "" || message.text.trim() === "") {
      return infrastructureFailure("email", "invalid-input");
    }

    const storedMessage = structuredClone(message);
    this.#messages.push(storedMessage);

    return infrastructureSuccess({
      messageId: `fake-email-${String(this.#messages.length).padStart(4, "0")}`,
      acceptedAt: this.#clock.now().toISOString(),
    });
  }
}

export class InMemoryFileStorage implements FileStorageService {
  readonly #failures = new DeterministicFailurePlan();
  readonly #files = new Map<string, StoredFile>();
  #writeCount = 0;

  failNext(code: InfrastructureFailureCode, retryAfterMs?: number): void {
    this.#failures.failNext(code, retryAfterMs);
  }

  throwNext(error: unknown): void {
    this.#failures.throwNext(error);
  }

  async put(file: FileWrite): Promise<InfrastructureResult<StoredFileMetadata>> {
    const failure = this.#failures.consume<StoredFileMetadata>("file-storage");
    if (failure) {
      return failure;
    }

    if (file.key.trim() === "" || file.contentType.trim() === "") {
      return infrastructureFailure("file-storage", "invalid-input");
    }

    this.#writeCount += 1;
    const metadata: StoredFileMetadata = {
      key: file.key,
      contentType: file.contentType,
      size: file.bytes.byteLength,
      etag: `fake-object-${String(this.#writeCount).padStart(4, "0")}`,
      metadata: { ...file.metadata },
    };
    this.#files.set(file.key, { metadata, bytes: file.bytes.slice() });

    return infrastructureSuccess(structuredClone(metadata));
  }

  async get(key: string): Promise<InfrastructureResult<StoredFile>> {
    const failure = this.#failures.consume<StoredFile>("file-storage");
    if (failure) {
      return failure;
    }

    const file = this.#files.get(key);
    if (!file) {
      return infrastructureFailure("file-storage", "not-found");
    }

    return infrastructureSuccess({ metadata: structuredClone(file.metadata), bytes: file.bytes.slice() });
  }

  async delete(key: string): Promise<InfrastructureResult<boolean>> {
    const failure = this.#failures.consume<boolean>("file-storage");
    if (failure) {
      return failure;
    }

    return infrastructureSuccess(this.#files.delete(key));
  }
}

export class DeterministicTokenGenerator implements TokenGeneratorService {
  readonly #failures = new DeterministicFailurePlan();
  readonly #seed: string;
  #sequence = 0;

  constructor(seed = "local") {
    this.#seed = seed.replaceAll(/[^a-zA-Z0-9_-]/g, "-") || "local";
  }

  failNext(code: InfrastructureFailureCode, retryAfterMs?: number): void {
    this.#failures.failNext(code, retryAfterMs);
  }

  throwNext(error: unknown): void {
    this.#failures.throwNext(error);
  }

  generate(request: TokenRequest): InfrastructureResult<string> {
    const failure = this.#failures.consume<string>("token-generator");
    if (failure) {
      return failure;
    }

    const byteLength = request.byteLength ?? 32;
    if (request.purpose.trim() === "" || !Number.isInteger(byteLength) || byteLength < 16 || byteLength > 128) {
      return infrastructureFailure("token-generator", "invalid-input");
    }

    this.#sequence += 1;
    const safePurpose = request.purpose.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
    return infrastructureSuccess(`fake-${safePurpose}-${this.#seed}-${String(this.#sequence).padStart(4, "0")}`);
  }
}

type AcceleventsHandler = (input: unknown) => unknown | Promise<unknown>;

export class DeterministicAcceleventsService implements AcceleventsService {
  readonly #failures = new DeterministicFailurePlan();
  readonly #handlers = new Map<string, AcceleventsHandler>();

  register<TInput, TOutput>(
    operation: AcceleventsOperation<TInput, TOutput>,
    handler: (input: TInput) => TOutput | Promise<TOutput>,
  ): void {
    this.#handlers.set(operation.name, (input) => handler(input as TInput));
  }

  failNext(code: InfrastructureFailureCode, retryAfterMs?: number): void {
    this.#failures.failNext(code, retryAfterMs);
  }

  throwNext(error: unknown): void {
    this.#failures.throwNext(error);
  }

  async execute<TInput, TOutput>(
    operation: AcceleventsOperation<TInput, TOutput>,
    input: TInput,
  ): Promise<InfrastructureResult<TOutput>> {
    const failure = this.#failures.consume<TOutput>("accelevents");
    if (failure) {
      return failure;
    }

    const handler = this.#handlers.get(operation.name);
    if (!handler) {
      return infrastructureFailure("accelevents", "not-found");
    }

    return captureInfrastructureResult("accelevents", async () => (await handler(input)) as TOutput);
  }
}
