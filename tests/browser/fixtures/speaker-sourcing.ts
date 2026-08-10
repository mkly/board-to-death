import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { provisionMagicLinkUser } from "../../../src/server/auth/magic-link-user.ts";
import { SpeakerSourcingRepository } from "../../../src/server/speaker-sourcing/repositories.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test"))
  throw new Error("The speaker sourcing fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";
const slug = "speaker-sourcing-browser";
const command = process.argv[2] ?? "seed";

if (command === "cleanup") {
  await database.event.deleteMany({ where: { slug } });
  await database.person.deleteMany({ where: { email: { in: ["manual@example.test", "public@example.test"] } } });
  await database.$disconnect();
  process.stdout.write(JSON.stringify({ cleaned: true }));
  process.exit(0);
}

await database.event.deleteMany({ where: { slug } });
await database.person.deleteMany({ where: { email: { in: ["manual@example.test", "public@example.test"] } } });
const event = await database.event.create({
  data: {
    name: "Speaker Sourcing Browser Event",
    slug,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-10-12T16:00:00.000Z"),
    endsAt: new Date("2027-10-14T01:00:00.000Z"),
  },
});
await database.person.create({
  data: {
    email: "manual@example.test",
    givenName: "Morgan",
    familyName: "Manual",
    organization: "Known Speakers",
  },
});
const interestForm = await new SpeakerSourcingRepository(database).createInterestForm({
  eventId: event.id,
  title: "Share your tabletop expertise",
  description: "Tell our program team what you would like to teach.",
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
if (deliveredLink === "") throw new Error("Expected the speaker sourcing fixture to receive a magic link.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");
await grantSeededOrganizationAccess(adminEmail);

process.stdout.write(
  JSON.stringify({
    activeEventId: event.id,
    eventSlug: event.slug,
    publicId: interestForm.publicId,
    sessionCookie,
  }),
);
await database.$disconnect();
