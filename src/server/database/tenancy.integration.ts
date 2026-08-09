import { PrismaPg } from "@prisma/adapter-pg";

import {
  EventMembershipRole,
  MembershipStatus,
  OrganizationMemberRole,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for tenancy integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const organizationIds = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"] as const;
const userId = "tenancy-integration-user";

async function cleanFixture(): Promise<void> {
  await client.event.deleteMany({ where: { orgId: { in: [...organizationIds] } } });
  await client.person.deleteMany({ where: { orgId: { in: [...organizationIds] } } });
  await client.organization.deleteMany({ where: { id: { in: [...organizationIds] } } });
  await client.user.deleteMany({ where: { id: userId } });
}

async function createOrganizations(): Promise<void> {
  await client.organization.createMany({
    data: [
      { id: organizationIds[0], name: "First Organization", slug: "tenancy-first" },
      { id: organizationIds[1], name: "Second Organization", slug: "tenancy-second" },
    ],
  });
}

describe("organization tenancy persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(cleanFixture);
  after(async () => {
    await cleanFixture();
    await client.$disconnect();
  });

  test("scopes person email uniqueness to an organization", async () => {
    await createOrganizations();

    const first = await client.person.create({
      data: {
        orgId: organizationIds[0],
        email: "shared@example.test",
        givenName: "First",
        familyName: "Person",
      },
    });
    const second = await client.person.create({
      data: {
        orgId: organizationIds[1],
        email: "shared@example.test",
        givenName: "Second",
        familyName: "Person",
      },
    });

    assert.notEqual(first.id, second.id);
    assert.equal(await client.person.count({ where: { email: "shared@example.test" } }), 2);
  });

  test("allows one user to belong to multiple organizations and carry event roles", async () => {
    await createOrganizations();
    await client.user.create({
      data: { id: userId, name: "Tenancy User", email: "tenancy-user@example.test", emailVerified: true },
    });
    await client.organizationMember.createMany({
      data: [
        { orgId: organizationIds[0], userId, role: OrganizationMemberRole.OWNER },
        { orgId: organizationIds[1], userId, role: OrganizationMemberRole.MEMBER },
      ],
    });

    const event = await client.event.create({
      data: {
        orgId: organizationIds[0],
        name: "Tenancy Event",
        slug: "tenancy-event",
        timezone: "UTC",
        startsAt: new Date("2027-01-01T00:00:00.000Z"),
        endsAt: new Date("2027-01-02T00:00:00.000Z"),
      },
    });
    const membership = await client.eventMembership.create({
      data: {
        eventId: event.id,
        userId,
        roles: [EventMembershipRole.ORGANIZER_ADMIN, EventMembershipRole.SPEAKER],
      },
    });

    assert.equal(await client.organizationMember.count({ where: { userId } }), 2);
    assert.deepEqual(membership.roles, [EventMembershipRole.ORGANIZER_ADMIN, EventMembershipRole.SPEAKER]);

    const revokedAt = new Date("2027-01-03T00:00:00.000Z");
    const revoked = await client.eventMembership.update({
      where: { eventId_userId: { eventId: event.id, userId } },
      data: { status: MembershipStatus.REVOKED, revokedAt },
    });
    assert.equal(revoked.status, MembershipStatus.REVOKED);
    assert.deepEqual(revoked.revokedAt, revokedAt);
  });
});
