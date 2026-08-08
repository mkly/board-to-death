import { IntegrationProvider, type Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface SaveAcceleventsConfigurationInput {
  readonly eventId: string;
  readonly remoteEventId: string;
  /** A key-vault or environment reference. The API key itself must never be supplied here. */
  readonly credentialReference: string;
}

export interface AcceleventsConfigurationView {
  readonly id: string;
  readonly eventId: string;
  readonly provider: "accelevents";
  readonly versionNumber: number;
  readonly remoteEventId: string;
  readonly credential: "[REDACTED]";
  readonly settings: Prisma.JsonValue;
  readonly createdAt: Date;
}

export interface AcceleventsAuditDetails {
  readonly configurationId: string;
  readonly eventId: string;
  readonly provider: "accelevents";
  readonly remoteEventId: string;
  readonly credential: "[REDACTED]";
  readonly versionNumber: number;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new RepositoryError("invalid-input", `${field} is required.`);
  return normalized;
}

function credentialReference(value: string): string {
  const normalized = requiredText(value, "credentialReference");
  if (!/^(?:secret|env):\/\/[A-Za-z0-9][A-Za-z0-9./_-]*$/.test(normalized)) {
    throw new RepositoryError(
      "invalid-input",
      "credentialReference must be a secret:// or env:// reference, never an API key.",
    );
  }
  return normalized;
}

function view(configuration: {
  readonly id: string;
  readonly eventId: string;
  readonly versions: readonly {
    readonly versionNumber: number;
    readonly remoteEventId: string;
    readonly settings: Prisma.JsonValue;
    readonly createdAt: Date;
  }[];
}): AcceleventsConfigurationView {
  const latest = configuration.versions[0];
  if (!latest) throw new Error(`Integration configuration ${configuration.id} has no version.`);
  return {
    id: configuration.id,
    eventId: configuration.eventId,
    provider: "accelevents",
    versionNumber: latest.versionNumber,
    remoteEventId: latest.remoteEventId,
    credential: "[REDACTED]",
    settings: latest.settings,
    createdAt: latest.createdAt,
  };
}

export function acceleventsAuditDetails(configuration: AcceleventsConfigurationView): AcceleventsAuditDetails {
  return {
    configurationId: configuration.id,
    eventId: configuration.eventId,
    provider: configuration.provider,
    remoteEventId: configuration.remoteEventId,
    credential: "[REDACTED]",
    versionNumber: configuration.versionNumber,
  };
}

export class AcceleventsConfigurationRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async save(input: SaveAcceleventsConfigurationInput): Promise<AcceleventsConfigurationView> {
    const remoteEventId = requiredText(input.remoteEventId, "remoteEventId");
    const reference = credentialReference(input.credentialReference);
    const id = await this.#client.$transaction(async (transaction) => {
      const event = await transaction.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
      if (!event) throw new RepositoryError("not-found", "The event was not found.");
      const configuration = await transaction.integrationConfiguration.upsert({
        where: { eventId_provider: { eventId: input.eventId, provider: IntegrationProvider.ACCELEVENTS } },
        create: { eventId: input.eventId, provider: IntegrationProvider.ACCELEVENTS },
        update: {},
        select: { id: true },
      });
      const latest = await transaction.integrationConfigurationVersion.findFirst({
        where: { configurationId: configuration.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      await transaction.integrationConfigurationVersion.create({
        data: {
          eventId: input.eventId,
          configurationId: configuration.id,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          remoteEventId,
          credentialReference: reference,
          settings: {},
        },
      });
      return configuration.id;
    });
    return this.requireById(input.eventId, id);
  }

  async get(eventId: string): Promise<AcceleventsConfigurationView | null> {
    const configuration = await this.#client.integrationConfiguration.findUnique({
      where: { eventId_provider: { eventId, provider: IntegrationProvider.ACCELEVENTS } },
      select: {
        id: true,
        eventId: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { versionNumber: true, remoteEventId: true, settings: true, createdAt: true },
        },
      },
    });
    return configuration ? view(configuration) : null;
  }

  private async requireById(eventId: string, id: string): Promise<AcceleventsConfigurationView> {
    const configuration = await this.#client.integrationConfiguration.findFirst({
      where: { eventId, id, provider: IntegrationProvider.ACCELEVENTS },
      select: {
        id: true,
        eventId: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { versionNumber: true, remoteEventId: true, settings: true, createdAt: true },
        },
      },
    });
    if (!configuration) throw new RepositoryError("not-found", "The Accelevents configuration was not found.");
    return view(configuration);
  }
}
