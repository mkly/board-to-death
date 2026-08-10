import { PrismaPg } from "@prisma/adapter-pg";

import {
  EventType,
  IntegrationProvider,
  IntegrationSyncRecordStatus,
  IntegrationSyncRunStatus,
  PrismaClient,
} from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";
import { randomUUID } from "node:crypto";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createAdministratorSession(): Promise<string> {
  const links: string[] = [];
  const browserAuth = createAuth({
    baseURL,
    database,
    isAllowedEmail: (email) => email.toLowerCase() === "admin@example.test",
    secret: "quality-gate-better-auth-secret-at-least-32-characters",
    sendMagicLink: async ({ url }) => {
      links.push(url);
    },
  });
  const signIn = await browserAuth.handler(
    new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: "admin@example.test", callbackURL: "/dashboard" }),
    }),
  );
  if (signIn.status !== 200) throw new Error(`Magic-link sign-in returned ${signIn.status}.`);
  const link = links[0];
  if (!link) throw new Error("Expected the browser administrator magic link to be delivered.");
  const verified = await browserAuth.handler(new Request(link, { redirect: "manual" }));
  const match = (verified.headers.get("set-cookie") ?? "").match(/better-auth\.session_token=([^;]+)/);
  if (!match?.[1]) throw new Error("Expected Better Auth to create a browser session cookie.");
  await grantSeededOrganizationAccess("admin@example.test");
  return match[1];
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

const CREDENTIAL_REFERENCE = "env://BROWSER_SYNC_STATUS_KEY_NEVER_RENDERED";

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const eventAId = randomUUID();
  const eventBId = randomUUID();
  const eventCId = randomUUID();
  const eventDId = randomUUID();
  const eventASlug = `browser-sync-status-a-${suffix}`;
  const eventBSlug = `browser-sync-status-b-${suffix}`;
  const eventCSlug = `browser-sync-status-c-${suffix}`;
  const eventDSlug = `browser-sync-status-d-${suffix}`;
  const retrySpeakerId = randomUUID();

  await database.event.create({
    data: {
      id: eventAId,
      name: "Sync Status Summit",
      slug: eventASlug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-04-10T17:00:00.000Z"),
      endsAt: new Date("2027-04-11T01:00:00.000Z"),
      speakers: {
        create: {
          id: retrySpeakerId,
          normalizedEmail: "retry-candidate@example.test",
          profileVersions: {
            create: {
              versionNumber: 1,
              email: "retry-candidate@example.test",
              givenName: "Retry",
              familyName: "Candidate",
              consentToPublishProfile: true,
              consentedAt: new Date("2027-01-10T18:00:00.000Z"),
            },
          },
        },
      },
      integrationConfigurations: {
        create: {
          provider: IntegrationProvider.ACCELEVENTS,
          versions: {
            create: {
              versionNumber: 1,
              remoteEventId: "sync-status-remote-event",
              credentialReference: CREDENTIAL_REFERENCE,
              settings: {},
            },
          },
          fieldMappings: {
            create: {
              resourceType: "speaker",
              key: "public-profile",
              versions: { create: { versionNumber: 1, definition: {} } },
            },
          },
        },
      },
    },
  });

  const configurationA = await database.integrationConfiguration.findUniqueOrThrow({
    where: { eventId_provider: { eventId: eventAId, provider: IntegrationProvider.ACCELEVENTS } },
    select: {
      id: true,
      versions: { select: { id: true } },
      fieldMappings: { select: { versions: { select: { id: true } } } },
    },
  });
  const configurationAId = configurationA.id;
  const configurationVersionAId = configurationA.versions[0]?.id;
  const mappingVersionAId = configurationA.fieldMappings[0]?.versions[0]?.id;
  if (!configurationVersionAId || !mappingVersionAId) {
    throw new Error("Expected the seeded configuration to have a version and a mapping version.");
  }

  function createRun(input: {
    readonly id: string;
    readonly status: IntegrationSyncRunStatus;
    readonly startedAt: Date;
    readonly completedAt: Date | null;
    readonly cancelRequestedAt?: Date | null;
    readonly records: ReadonlyArray<{
      readonly localId: string;
      readonly status: IntegrationSyncRecordStatus;
      readonly errorCode?: string | null;
      readonly retryAfter?: Date | null;
      readonly remoteId?: string | null;
      readonly completedAt?: Date | null;
    }>;
  }) {
    return database.integrationSyncRun.create({
      data: {
        id: input.id,
        eventId: eventAId,
        configurationId: configurationAId,
        configurationVersionId: configurationVersionAId,
        mappingVersionId: mappingVersionAId,
        idempotencyKey: randomUUID(),
        status: input.status,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        cancelRequestedAt: input.cancelRequestedAt ?? null,
        records: {
          create: input.records.map((record) => ({
            resourceType: "speaker",
            localId: record.localId,
            remoteId: record.remoteId ?? null,
            status: record.status,
            errorCode: record.errorCode ?? null,
            retryAfter: record.retryAfter ?? null,
            inputHash: "seed-hash",
            redactedRequestContext: {},
            startedAt: input.startedAt,
            completedAt:
              record.status === IntegrationSyncRecordStatus.PENDING
                ? null
                : (record.completedAt ?? input.completedAt ?? input.startedAt),
          })),
        },
      },
    });
  }

  const runCancelledId = randomUUID();
  await createRun({
    id: runCancelledId,
    status: IntegrationSyncRunStatus.CANCELLED,
    startedAt: minutesAgo(10),
    completedAt: minutesAgo(2),
    cancelRequestedAt: minutesAgo(3),
    records: [
      { localId: "cancel-succeeded", status: IntegrationSyncRecordStatus.SUCCEEDED, remoteId: "remote-cancel-1" },
      { localId: "cancel-skipped", status: IntegrationSyncRecordStatus.SKIPPED },
    ],
  });

  const runMixedId = randomUUID();
  await createRun({
    id: runMixedId,
    status: IntegrationSyncRunStatus.PARTIALLY_FAILED,
    startedAt: minutesAgo(20),
    completedAt: minutesAgo(15),
    records: [
      { localId: "mixed-succeeded", status: IntegrationSyncRecordStatus.SUCCEEDED, remoteId: "remote-mixed-1" },
      {
        localId: "mixed-invalid-email",
        status: IntegrationSyncRecordStatus.VALIDATION_FAILED,
        errorCode: "invalid-email",
      },
      { localId: "mixed-unauthorized", status: IntegrationSyncRecordStatus.TERMINAL_FAILED, errorCode: "unauthorized" },
      {
        localId: "mixed-rate-limited",
        status: IntegrationSyncRecordStatus.RETRIABLE_FAILED,
        errorCode: "rate-limited",
        retryAfter: minutesFromNow(30),
      },
    ],
  });

  const runThrottledId = randomUUID();
  await createRun({
    id: runThrottledId,
    status: IntegrationSyncRunStatus.PARTIALLY_FAILED,
    startedAt: minutesAgo(25),
    completedAt: minutesAgo(24),
    records: [
      { localId: "throttle-succeeded", status: IntegrationSyncRecordStatus.SUCCEEDED, remoteId: "remote-throttle-1" },
      {
        localId: "throttle-limited",
        status: IntegrationSyncRecordStatus.RETRIABLE_FAILED,
        errorCode: "rate-limited",
        retryAfter: minutesFromNow(15),
      },
    ],
  });

  const runCredentialId = randomUUID();
  await createRun({
    id: runCredentialId,
    status: IntegrationSyncRunStatus.FAILED,
    startedAt: minutesAgo(30),
    completedAt: minutesAgo(29),
    records: [
      { localId: "cred-fail-1", status: IntegrationSyncRecordStatus.TERMINAL_FAILED, errorCode: "unauthorized" },
      { localId: "cred-fail-2", status: IntegrationSyncRecordStatus.TERMINAL_FAILED, errorCode: "unauthorized" },
    ],
  });

  const runToRetryId = randomUUID();
  await createRun({
    id: runToRetryId,
    status: IntegrationSyncRunStatus.PARTIALLY_FAILED,
    startedAt: minutesAgo(40),
    completedAt: minutesAgo(39),
    records: [
      {
        localId: "retry-succeeded-baseline",
        status: IntegrationSyncRecordStatus.SUCCEEDED,
        remoteId: "remote-retry-baseline",
      },
      {
        localId: retrySpeakerId,
        status: IntegrationSyncRecordStatus.RETRIABLE_FAILED,
        errorCode: "unavailable",
        retryAfter: minutesAgo(35),
      },
    ],
  });

  await database.event.create({
    data: {
      id: eventBId,
      name: "Cross Event Conference",
      slug: eventBSlug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-05-10T17:00:00.000Z"),
      endsAt: new Date("2027-05-11T01:00:00.000Z"),
      integrationConfigurations: {
        create: {
          provider: IntegrationProvider.ACCELEVENTS,
          versions: {
            create: {
              versionNumber: 1,
              remoteEventId: "cross-event-remote-event",
              credentialReference: "env://CROSS_EVENT_KEY",
              settings: {},
            },
          },
          fieldMappings: {
            create: {
              resourceType: "speaker",
              key: "public-profile",
              versions: { create: { versionNumber: 1, definition: {} } },
            },
          },
        },
      },
    },
  });
  const configurationB = await database.integrationConfiguration.findUniqueOrThrow({
    where: { eventId_provider: { eventId: eventBId, provider: IntegrationProvider.ACCELEVENTS } },
    select: {
      id: true,
      versions: { select: { id: true } },
      fieldMappings: { select: { versions: { select: { id: true } } } },
    },
  });
  const configurationVersionBId = configurationB.versions[0]?.id;
  const mappingVersionBId = configurationB.fieldMappings[0]?.versions[0]?.id;
  if (!configurationVersionBId || !mappingVersionBId) {
    throw new Error("Expected the seeded cross-event configuration to have a version and a mapping version.");
  }
  await database.integrationSyncRun.create({
    data: {
      eventId: eventBId,
      configurationId: configurationB.id,
      configurationVersionId: configurationVersionBId,
      mappingVersionId: mappingVersionBId,
      idempotencyKey: randomUUID(),
      status: IntegrationSyncRunStatus.SUCCEEDED,
      startedAt: minutesAgo(5),
      completedAt: minutesAgo(4),
      records: {
        create: [
          {
            resourceType: "speaker",
            localId: "crossb-only-record",
            remoteId: "crossb-remote-1",
            status: IntegrationSyncRecordStatus.SUCCEEDED,
            inputHash: "seed-hash",
            redactedRequestContext: {},
            startedAt: minutesAgo(5),
            completedAt: minutesAgo(4),
          },
        ],
      },
    },
  });

  await database.event.create({
    data: {
      id: eventCId,
      name: "Empty History Conference",
      slug: eventCSlug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-06-10T17:00:00.000Z"),
      endsAt: new Date("2027-06-11T01:00:00.000Z"),
    },
  });

  await database.event.create({
    data: {
      id: eventDId,
      name: "Active Run Conference",
      slug: eventDSlug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-07-10T17:00:00.000Z"),
      endsAt: new Date("2027-07-11T01:00:00.000Z"),
      integrationConfigurations: {
        create: {
          provider: IntegrationProvider.ACCELEVENTS,
          versions: {
            create: {
              versionNumber: 1,
              remoteEventId: "active-run-remote-event",
              credentialReference: "env://ACTIVE_RUN_KEY",
              settings: {},
            },
          },
          fieldMappings: {
            create: {
              resourceType: "speaker",
              key: "public-profile",
              versions: { create: { versionNumber: 1, definition: {} } },
            },
          },
        },
      },
    },
  });
  const configurationD = await database.integrationConfiguration.findUniqueOrThrow({
    where: { eventId_provider: { eventId: eventDId, provider: IntegrationProvider.ACCELEVENTS } },
    select: {
      id: true,
      versions: { select: { id: true } },
      fieldMappings: { select: { versions: { select: { id: true } } } },
    },
  });
  const configurationVersionDId = configurationD.versions[0]?.id;
  const mappingVersionDId = configurationD.fieldMappings[0]?.versions[0]?.id;
  if (!configurationVersionDId || !mappingVersionDId) {
    throw new Error("Expected the seeded active-run configuration to have a version and a mapping version.");
  }

  // Kept on its own event: this run stays RUNNING indefinitely (cancellation only sets
  // cancelRequestedAt), and assertNoConcurrentSyncRun blocks any push for an event while
  // one of its runs is RUNNING, so it must not share an event with runToRetryId.
  const runActiveId = randomUUID();
  await database.integrationSyncRun.create({
    data: {
      id: runActiveId,
      eventId: eventDId,
      configurationId: configurationD.id,
      configurationVersionId: configurationVersionDId,
      mappingVersionId: mappingVersionDId,
      idempotencyKey: randomUUID(),
      status: IntegrationSyncRunStatus.RUNNING,
      startedAt: minutesAgo(2),
      completedAt: null,
      records: {
        create: [
          {
            resourceType: "speaker",
            localId: "active-succeeded",
            remoteId: "remote-active-1",
            status: IntegrationSyncRecordStatus.SUCCEEDED,
            inputHash: "seed-hash",
            redactedRequestContext: {},
            startedAt: minutesAgo(2),
            completedAt: minutesAgo(1),
          },
          {
            resourceType: "speaker",
            localId: "active-pending",
            status: IntegrationSyncRecordStatus.PENDING,
            inputHash: "seed-hash",
            redactedRequestContext: {},
            startedAt: minutesAgo(2),
            completedAt: null,
          },
        ],
      },
    },
  });

  return {
    eventAId,
    eventASlug,
    eventBId,
    eventBSlug,
    eventCId,
    eventCSlug,
    eventDId,
    eventDSlug,
    runActiveId,
    runCancelledId,
    runMixedId,
    runThrottledId,
    runCredentialId,
    runToRetryId,
    credentialReference: CREDENTIAL_REFERENCE,
    sessionToken: await createAdministratorSession(),
  };
}

const action = process.argv[2];
try {
  await database.$connect();
  if (action === "setup") {
    process.stdout.write(JSON.stringify(await setup()));
  } else if (action === "cleanup") {
    const eventIds = process.argv.slice(3);
    if (eventIds.length === 0) throw new Error("At least one eventId is required for cleanup.");
    // IntegrationSyncRecord.remoteRecord is onDelete: Restrict, so a real retry push that links a
    // record to a remote record must be cleared before the event cascade reaches remote records
    // (see speaker-push.integration.ts / session-push.integration.ts for the same precaution).
    await database.integrationSyncRecord.deleteMany({ where: { eventId: { in: eventIds } } });
    await database.event.deleteMany({ where: { id: { in: eventIds } } });
  } else {
    throw new Error(`Unknown fixture action: ${action ?? "missing"}`);
  }
} finally {
  await database.$disconnect();
}
