import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import {
  createContact,
  createContactGroup,
  createContactGroupTier,
  listContactGroups,
  listContactGroupTiers,
  removeContactGroupTier,
  renameContactGroupTier,
  reorderContactGroupTiers,
  updateContactGroup,
} from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for contact repository integration tests.");
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: slug,
      slug,
      timezone: "UTC",
      startsAt: new Date("2027-06-01T09:00:00.000Z"),
      endsAt: new Date("2027-06-02T17:00:00.000Z"),
      sponsorsEnabled: true,
      exhibitorsEnabled: true,
    },
  });
}

describe("contact group tiers and primary contacts", () => {
  before(async () => client.$connect());
  beforeEach(async () => client.event.deleteMany());
  after(async () => client.$disconnect());

  test("creates, renames, reorders, and guards removal of event tiers", async () => {
    const event = await createEvent("tier-management");
    const bronze = await createContactGroupTier(client, { eventId: event.id, kind: "SPONSOR", name: "Bronze" });
    const gold = await createContactGroupTier(client, { eventId: event.id, kind: "SPONSOR", name: "Gold" });
    await renameContactGroupTier(client, event.id, bronze.id, "Community");
    await reorderContactGroupTiers(client, event.id, "SPONSOR", [gold.id, bronze.id]);
    assert.deepEqual(
      (await listContactGroupTiers(client, event.id, "SPONSOR")).map(({ name, sortOrder }) => [name, sortOrder]),
      [
        ["Gold", 0],
        ["Community", 1],
      ],
    );

    await createContactGroup(client, { eventId: event.id, kind: "SPONSOR", name: "Ada Labs", tierId: gold.id });
    await assert.rejects(
      removeContactGroupTier(client, event.id, gold.id),
      (error: unknown) => error instanceof RepositoryError && /Move groups/.test(error.message),
    );
    await removeContactGroupTier(client, event.id, bronze.id);
    assert.deepEqual(
      (await listContactGroupTiers(client, event.id, "SPONSOR")).map(({ id }) => id),
      [gold.id],
    );
  });

  test("reassigns primary contacts and filters and sorts groups by tier", async () => {
    const event = await createEvent("group-primary");
    const other = await createEvent("group-primary-other");
    const gold = await createContactGroupTier(client, { eventId: event.id, kind: "SPONSOR", name: "Gold" });
    const silver = await createContactGroupTier(client, { eventId: event.id, kind: "SPONSOR", name: "Silver" });
    await reorderContactGroupTiers(client, event.id, "SPONSOR", [gold.id, silver.id]);
    const ada = await createContact(client, {
      eventId: event.id,
      email: "ada@example.test",
      givenName: "Ada",
      familyName: "Lovelace",
    });
    const grace = await createContact(client, {
      eventId: event.id,
      email: "grace@example.test",
      givenName: "Grace",
      familyName: "Hopper",
    });
    const foreign = await createContact(client, {
      eventId: other.id,
      email: "foreign@example.test",
      givenName: "Foreign",
      familyName: "Contact",
    });
    const silverGroup = await createContactGroup(client, {
      eventId: event.id,
      kind: "SPONSOR",
      name: "Silver Labs",
      tierId: silver.id,
      primaryContactId: ada.id,
    });
    await createContactGroup(client, { eventId: event.id, kind: "SPONSOR", name: "Gold Labs", tierId: gold.id });
    await updateContactGroup(client, event.id, silverGroup.id, { primaryContactId: grace.id });

    const groups = await listContactGroups(client, event.id, { sortBy: "tier" });
    assert.deepEqual(
      groups.map(({ name }) => name),
      ["Gold Labs", "Silver Labs"],
    );
    assert.equal(groups[1]?.primaryContact?.email, "grace@example.test");
    assert.deepEqual(
      (await listContactGroups(client, event.id, { tierIds: [silver.id] })).map(({ name }) => name),
      ["Silver Labs"],
    );
    await assert.rejects(
      updateContactGroup(client, event.id, silverGroup.id, { primaryContactId: foreign.id }),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
  });
});
