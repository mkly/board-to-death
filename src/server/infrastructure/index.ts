export type {
  DeterministicInfrastructure,
  DeterministicInfrastructureOptions,
} from "./composition.ts";
export { composeInfrastructure, createDeterministicInfrastructure } from "./composition.ts";
export type {
  AcceleventsOperation,
  AcceleventsService,
  ClockService,
  EmailAddress,
  EmailAttachment,
  EmailDelivery,
  EmailMessage,
  EmailService,
  FileStorageService,
  FileWrite,
  InfrastructureFailure,
  InfrastructureFailureCode,
  InfrastructureResult,
  InfrastructureServiceName,
  InfrastructureServices,
  PersistenceService,
  StoredFile,
  StoredFileMetadata,
  TokenGeneratorService,
  TokenRequest,
} from "./contracts.ts";
export {
  defineAcceleventsOperation,
  infrastructureFailureCodes,
  infrastructureServiceNames,
} from "./contracts.ts";
export {
  DeterministicAcceleventsService,
  DeterministicClock,
  DeterministicEmailService,
  DeterministicPersistence,
  DeterministicTokenGenerator,
  InMemoryFileStorage,
} from "./fakes.ts";
export { contentDisposition, safeFileName } from "./file-names.ts";
export type { FileStorageOptions, LocalFileStorageOptions } from "./file-storage.ts";
export { createFileStorage, LocalFileStorage } from "./file-storage.ts";
export { isSafeObjectKey } from "./object-key.ts";
// ./resend-email.ts is intentionally absent from this barrel: it is "server-only",
// and re-exporting it here makes every barrel consumer — including the Vitest
// suites that import the deterministic fakes — throw on import. Import it by path,
// as ./configured-file-storage.ts is imported.
export {
  captureInfrastructureResult,
  infrastructureFailure,
  infrastructureSuccess,
  normalizeInfrastructureFailure,
} from "./results.ts";
export type { S3FileStorageOptions } from "./s3-file-storage.ts";
export { S3FileStorage } from "./s3-file-storage.ts";
export type {
  SpeakerFileDownload,
  SpeakerFileOwner,
  SpeakerFilePrincipal,
  SpeakerFileReference,
  SpeakerFileServiceOptions,
  SpeakerFileWrite,
} from "./speaker-files.ts";
export { SpeakerFileService } from "./speaker-files.ts";
