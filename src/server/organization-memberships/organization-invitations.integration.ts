import { PrismaPg } from "@prisma/adapter-pg";

import {
  MembershipStatus,
  OrganizationInvitationStatus,
  OrganizationMemberRole,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { OrganizationInvitationService } from "./organization-invitations.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for organization invitation integration tests.");
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const service = new OrganizationInvitationService(client);
const createdOrganizationIds: string[] = [];
const createdUserIds: string[] = [];

function tokenFromCallback(callbackURL: string): string {
  const token = callbackURL.split("/").at(-1);
  if (!token) throw new Error("Expected the invitation callback to contain a token.");
  return decodeURIComponent(token);
}

async function createOrganization() {
  const suffix = randomUUID().slice(0, 8);
  const organization = await client.organization.create({
    data: { name: `Invitation org ${suffix}`, slug: `organization-invitation-${suffix}` },
  });
  createdOrganizationIds.push(organization.id);
  return organization;
}

async function createUser(name: string) {
  const suffix = randomUUID().slice(0, 8);
  const user = await client.user.create({
    data: { id: randomUUID(), name, email: `${name.toLowerCase().replaceAll(" ", "-")}-${suffix}@example.test` },
  });
  createdUserIds.push(user.id);
  return user;
}

before(async () => {
  await client.$connect();
});

after(async () => {
  await client.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
  await client.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await client.$disconnect();
});

describe("organization invitations", () => {
  test("invites a non-member and accepts with the invited role", async () => {
    const organization = await createOrganization();
    const inviter = await createUser("Inviting Owner");
    const invitee = await createUser("Invited Owner");
    let callbackURL = "";

    await service.invite(
      {
        organizationId: organization.id,
        inviterId: inviter.id,
        email: invitee.email.toUpperCase(),
        role: OrganizationMemberRole.OWNER,
      },
      async (delivery) => {
        callbackURL = delivery.callbackURL;
      },
    );

    const pending = await client.organizationInvitation.findFirstOrThrow({
      where: { orgId: organization.id, email: invitee.email },
    });
    assert.equal(pending.inviterId, inviter.id);
    assert.equal(pending.status, OrganizationInvitationStatus.PENDING);
    assert.deepEqual(await service.list(organization.id), {
      invitations: [
        {
          id: pending.id,
          email: invitee.email,
          role: OrganizationMemberRole.OWNER,
          status: OrganizationInvitationStatus.PENDING,
          expiresAt: pending.expiresAt,
          createdAt: pending.createdAt,
        },
      ],
      memberships: [],
    });

    const result = await service.accept(tokenFromCallback(callbackURL), invitee);
    const membership = await client.organizationMember.findUniqueOrThrow({
      where: { orgId_userId: { orgId: organization.id, userId: invitee.id } },
    });
    assert.deepEqual(result, { organizationId: organization.id, role: OrganizationMemberRole.OWNER });
    assert.equal(membership.role, OrganizationMemberRole.OWNER);
    assert.equal(membership.status, MembershipStatus.ACTIVE);
    assert.equal(
      (await client.organizationInvitation.findUniqueOrThrow({ where: { id: pending.id } })).status,
      OrganizationInvitationStatus.ACCEPTED,
    );
  });

  test("rejects active members and revokes an earlier pending invitation for the same email", async () => {
    const organization = await createOrganization();
    const inviter = await createUser("Second Inviter");
    const invitee = await createUser("Pending Invitee");
    let firstCallback = "";

    await service.invite(
      {
        organizationId: organization.id,
        inviterId: inviter.id,
        email: invitee.email,
        role: OrganizationMemberRole.MEMBER,
      },
      async ({ callbackURL }) => {
        firstCallback = callbackURL;
      },
    );
    await service.invite(
      {
        organizationId: organization.id,
        inviterId: inviter.id,
        email: invitee.email,
        role: OrganizationMemberRole.OWNER,
      },
      async () => undefined,
    );
    const invitations = await client.organizationInvitation.findMany({
      where: { orgId: organization.id, email: invitee.email },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      invitations.map(({ status }) => status),
      [OrganizationInvitationStatus.REVOKED, OrganizationInvitationStatus.PENDING],
    );
    await assert.rejects(() => service.accept(tokenFromCallback(firstCallback), invitee), /invalid, expired, or/);

    await client.organizationMember.create({
      data: { orgId: organization.id, userId: invitee.id, role: OrganizationMemberRole.MEMBER },
    });
    await assert.rejects(
      () =>
        service.invite(
          {
            organizationId: organization.id,
            inviterId: inviter.id,
            email: invitee.email,
            role: OrganizationMemberRole.MEMBER,
          },
          async () => undefined,
        ),
      /already an active member/,
    );
  });

  test("rotates resend tokens and rejects revoked invitations", async () => {
    const organization = await createOrganization();
    const inviter = await createUser("Third Inviter");
    const invitee = await createUser("Revoked Invitee");
    let originalCallback = "";

    await service.invite(
      {
        organizationId: organization.id,
        inviterId: inviter.id,
        email: invitee.email,
        role: OrganizationMemberRole.MEMBER,
      },
      async ({ callbackURL }) => {
        originalCallback = callbackURL;
      },
    );
    const pending = await client.organizationInvitation.findFirstOrThrow({
      where: { orgId: organization.id, email: invitee.email },
    });
    let replacementCallback = "";
    await service.resend(organization.id, pending.id, async ({ callbackURL }) => {
      replacementCallback = callbackURL;
    });
    await assert.rejects(() => service.accept(tokenFromCallback(originalCallback), invitee), /invalid, expired, or/);

    await service.revoke(organization.id, pending.id);
    await assert.rejects(() => service.accept(tokenFromCallback(replacementCallback), invitee), /invalid, expired, or/);
  });

  test("lists memberships and preserves at least one active owner when access changes", async () => {
    const organization = await createOrganization();
    const owner = await createUser("Membership Owner");
    const member = await createUser("Membership Member");
    const [ownerMembership, memberMembership] = await Promise.all([
      client.organizationMember.create({
        data: { orgId: organization.id, userId: owner.id, role: OrganizationMemberRole.OWNER },
      }),
      client.organizationMember.create({
        data: { orgId: organization.id, userId: member.id, role: OrganizationMemberRole.MEMBER },
      }),
    ]);

    const snapshot = await service.list(organization.id);
    assert.deepEqual(
      snapshot.memberships.map(({ id, userId, email, displayName, role, status }) => ({
        id,
        userId,
        email,
        displayName,
        role,
        status,
      })),
      [
        {
          id: ownerMembership.id,
          userId: owner.id,
          email: owner.email,
          displayName: owner.name,
          role: OrganizationMemberRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
        {
          id: memberMembership.id,
          userId: member.id,
          email: member.email,
          displayName: member.name,
          role: OrganizationMemberRole.MEMBER,
          status: MembershipStatus.ACTIVE,
        },
      ],
    );

    await service.setMembershipActive(organization.id, memberMembership.id, false);
    assert.equal(
      (await client.organizationMember.findUniqueOrThrow({ where: { id: memberMembership.id } })).status,
      MembershipStatus.REVOKED,
    );
    await assert.rejects(
      () => service.setMembershipActive(organization.id, ownerMembership.id, false),
      /Add another active owner/,
    );
    await service.setMembershipActive(organization.id, memberMembership.id, true);
    assert.equal(
      (await client.organizationMember.findUniqueOrThrow({ where: { id: memberMembership.id } })).status,
      MembershipStatus.ACTIVE,
    );
  });
});
