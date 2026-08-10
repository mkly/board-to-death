import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { FileRequestFulfillmentLinkService } from "../../../src/server/files/fulfillment-links.ts";
import { DeterministicTokenGenerator } from "../../../src/server/infrastructure/fakes.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) {
  throw new Error("The file request fulfillment fixture requires a guarded *_test database.");
}

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
await database.integrationSyncRecord.deleteMany();
await database.event.deleteMany();

async function createEvent(slug: string, name: string) {
  return await database.event.create({
    data: {
      name,
      slug,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-05-10T16:00:00.000Z"),
      endsAt: new Date("2027-05-12T00:00:00.000Z"),
    },
  });
}

async function createRequestAssignment(
  eventId: string,
  input: {
    readonly title: string;
    readonly instructions: string;
    readonly contactId?: string;
    readonly groupId?: string;
  },
) {
  const targetKind = input.contactId ? "CONTACT" : "GROUP";
  const request = await database.fileRequest.create({
    data: {
      eventId,
      key: input.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
      targetKind,
      versions: {
        create: {
          versionNumber: 1,
          title: input.title,
          instructions: input.instructions,
          dueOffsetDays: 7,
          allowedContentTypes: ["application/pdf"],
          maxBytes: 5 * 1024 * 1024,
          replacementPolicy: "REPLACE_LATEST",
        },
      },
    },
    include: { versions: true },
  });
  const version = request.versions[0];
  if (!version) throw new Error("Expected the fulfillment fixture to create a request version.");
  return await database.fileRequestAssignment.create({
    data: {
      eventId,
      requestId: request.id,
      requestVersionId: version.id,
      contactId: input.contactId,
      groupId: input.groupId,
      dueAt: new Date("2027-05-03T16:00:00.000Z"),
    },
  });
}

const event = await createEvent("fulfillment-summit", "Fulfillment Summit");
const otherEvent = await createEvent("other-fulfillment-summit", "Other Fulfillment Summit");
const contact = await database.contact.create({
  data: {
    eventId: event.id,
    email: "contact@example.test",
    givenName: "Dana",
    familyName: "Reed",
  },
});
const groupContact = await database.contact.create({
  data: {
    eventId: event.id,
    email: "member@example.test",
    givenName: "Kai",
    familyName: "Nakamura",
  },
});
const group = await database.contactGroup.create({
  data: { eventId: event.id, slug: "sponsors", name: "Sponsors", kind: "SPONSOR" },
});
await database.contactGroupMember.create({
  data: { eventId: event.id, groupId: group.id, contactId: groupContact.id },
});
const otherContact = await database.contact.create({
  data: {
    eventId: otherEvent.id,
    email: "other@example.test",
    givenName: "Other",
    familyName: "Contact",
  },
});

const contactAssignment = await createRequestAssignment(event.id, {
  title: "Signed sponsor contract",
  instructions: "Return the countersigned PDF.",
  contactId: contact.id,
});
const groupAssignment = await createRequestAssignment(event.id, {
  title: "Sponsor logo pack",
  instructions: "Upload the final sponsor artwork.",
  groupId: group.id,
});
const otherAssignment = await createRequestAssignment(otherEvent.id, {
  title: "Other event private tax form",
  instructions: "This belongs to another event.",
  contactId: otherContact.id,
});

const links = new FileRequestFulfillmentLinkService({
  database,
  tokenGenerator: new DeterministicTokenGenerator("browser"),
});
const [contactLink] = await links.issue(event.id, contactAssignment.id);
const [groupLink] = await links.issue(event.id, groupAssignment.id);
const [otherLink] = await links.issue(otherEvent.id, otherAssignment.id);
if (!contactLink || !groupLink || !otherLink)
  throw new Error("Expected fulfillment links for every fixture assignment.");

process.stdout.write(
  JSON.stringify({ contactToken: contactLink.token, groupToken: groupLink.token, otherToken: otherLink.token }),
);
await database.$disconnect();
