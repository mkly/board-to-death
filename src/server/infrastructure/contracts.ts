export const infrastructureServiceNames = [
  "persistence",
  "email",
  "file-storage",
  "clock",
  "token-generator",
  "accelevents",
] as const;

export type InfrastructureServiceName = (typeof infrastructureServiceNames)[number];

export const infrastructureFailureCodes = [
  "invalid-input",
  "unauthorized",
  "not-found",
  "conflict",
  "rate-limited",
  "timeout",
  "unavailable",
  "unexpected",
] as const;

export type InfrastructureFailureCode = (typeof infrastructureFailureCodes)[number];

export interface InfrastructureFailure {
  readonly service: InfrastructureServiceName;
  readonly code: InfrastructureFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export type InfrastructureResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: InfrastructureFailure };

export interface PersistenceService<TRepositories extends object> {
  transaction<T>(work: (repositories: TRepositories) => T | Promise<T>): Promise<InfrastructureResult<T>>;
}

export interface EmailAddress {
  readonly address: string;
  readonly name?: string;
}

export interface EmailMessage {
  readonly to: readonly EmailAddress[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly idempotencyKey?: string;
}

export interface EmailDelivery {
  readonly messageId: string;
  readonly acceptedAt: string;
}

export interface EmailService {
  send(message: EmailMessage): Promise<InfrastructureResult<EmailDelivery>>;
}

export interface FileWrite {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface StoredFileMetadata {
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly etag: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StoredFile {
  readonly metadata: StoredFileMetadata;
  readonly bytes: Uint8Array;
}

export interface FileStorageService {
  put(file: FileWrite): Promise<InfrastructureResult<StoredFileMetadata>>;
  get(key: string): Promise<InfrastructureResult<StoredFile>>;
  delete(key: string): Promise<InfrastructureResult<boolean>>;
}

export interface ClockService {
  now(): Date;
}

export interface TokenRequest {
  readonly purpose: string;
  readonly byteLength?: number;
}

export interface TokenGeneratorService {
  generate(request: TokenRequest): InfrastructureResult<string>;
}

export interface AcceleventsOperation<TInput, TOutput> {
  readonly name: string;
  readonly inputType?: TInput;
  readonly outputType?: TOutput;
}

export interface AcceleventsService {
  execute<TInput, TOutput>(
    operation: AcceleventsOperation<TInput, TOutput>,
    input: TInput,
  ): Promise<InfrastructureResult<TOutput>>;
}

export interface InfrastructureServices<TRepositories extends object> {
  readonly persistence: PersistenceService<TRepositories>;
  readonly email: EmailService;
  readonly fileStorage: FileStorageService;
  readonly clock: ClockService;
  readonly tokenGenerator: TokenGeneratorService;
  readonly accelevents: AcceleventsService;
}

export function defineAcceleventsOperation<TInput, TOutput>(name: string): AcceleventsOperation<TInput, TOutput> {
  return { name };
}
