import { PrismaPg } from "@prisma/adapter-pg";

import { IntegrationProvider, PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { provisionMagicLinkUser } from "../../../src/server/auth/magic-link-user.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";
import { createHash } from "node:crypto";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) throw new Error("The speaker mapping fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";

await database.integrationSyncRecord.deleteMany();
await database.event.deleteMany();
await database.verification.deleteMany();
await database.account.deleteMany();
await database.session.deleteMany();
await database.user.deleteMany();

const event = await database.event.create({
  data: {
    name: "Speaker Mapping Summit",
    slug: "speaker-mapping-summit",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-06-10T16:00:00.000Z"),
    endsAt: new Date("2027-06-12T00:00:00.000Z"),
  },
});
const configuration = await database.integrationConfiguration.create({
  data: {
    eventId: event.id,
    provider: IntegrationProvider.ACCELEVENTS,
    versions: {
      create: {
        versionNumber: 1,
        remoteEventId: "speaker-mapping-summit",
        credentialReference: "local://browser/accelevents",
        settings: { adapter: "deterministic" },
      },
    },
    fieldMappings: {
      create: {
        resourceType: "speaker",
        key: "public-profile",
        versions: {
          create: {
            versionNumber: 1,
            definition: {
              email: "profile.email",
              firstName: "profile.givenName",
              lastName: "profile.familyName",
            },
          },
        },
      },
    },
  },
  include: { fieldMappings: { include: { versions: true } } },
});
const mappingVersionId = configuration.fieldMappings[0]?.versions[0]?.id;
if (!mappingVersionId) throw new Error("Expected a speaker mapping version.");

const records: { localId: string; remoteId: string; comparisonHash: string }[] = [];
for (let index = 0; index < 12; index += 1) {
  const email = index === 3 ? "invalid-email" : `speaker-${index + 1}@example.test`;
  const givenName = index === 4 ? "=2+3" : `Speaker ${index + 1}`;
  const familyName = "Example";
  const speaker = await database.speaker.create({
    data: {
      eventId: event.id,
      normalizedEmail: email,
      profileVersions: {
        create: {
          versionNumber: 1,
          email,
          givenName,
          familyName,
          organization: `Organization ${index + 1}`,
          consentToPublishProfile: index !== 2,
          consentedAt: index === 2 ? null : new Date("2027-01-10T18:00:00.000Z"),
        },
      },
    },
  });
  if (index < 2) {
    const outbound = { email, firstName: givenName, lastName: familyName };
    records.push({
      localId: speaker.id,
      remoteId: `remote-speaker-${index + 1}`,
      comparisonHash:
        index === 0 ? createHash("sha256").update(JSON.stringify(outbound)).digest("hex") : "outdated-hash",
    });
  }
}
await database.integrationRemoteRecord.createMany({
  data: records.map((record) => ({
    eventId: event.id,
    configurationId: configuration.id,
    mappingVersionId,
    resourceType: "speaker",
    ...record,
  })),
});

let deliveredLink = "";
const browserAuth = createAuth({
  baseURL,
  database,
  isAllowedEmail: (email) => email === adminEmail,
  secret: "quality-gate-better-auth-secret-at-least-32-characters",
  sendMagicLink: async ({ url }) => {
    deliveredLink = url;
  },
});
await provisionMagicLinkUser(database, { email: adminEmail });
await browserAuth.handler(
  new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ email: adminEmail, callbackURL: "/dashboard" }),
  }),
);
if (deliveredLink === "") throw new Error("Expected a magic link.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected a browser session cookie.");
await grantSeededOrganizationAccess(adminEmail);

process.stdout.write(JSON.stringify({ eventSlug: event.slug, sessionCookie }));
await database.$disconnect();
