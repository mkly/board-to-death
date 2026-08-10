import { PrismaPg } from "@prisma/adapter-pg";

import {
  EvaluationReviewerStatus,
  EventInvitationStatus,
  EventMembershipRole,
  EventType,
  MembershipStatus,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { EventInvitationService } from "./event-invitations.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for event invitation integration tests.");
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const service = new EventInvitationService(client);
const createdOrganizationIds: string[] = [];
const createdUserIds: string[] = [];

function tokenFromCallback(callbackURL: string): string {
  const token = callbackURL.split("/").at(-1);
  if (!token) throw new Error("Expected the invitation callback to contain a token.");
  return decodeURIComponent(token);
}

async function createEventPair() {
  const suffix = randomUUID().slice(0, 8);
  const organization = await client.organization.create({
    data: { name: `Invitation org ${suffix}`, slug: `invitation-org-${suffix}` },
  });
  createdOrganizationIds.push(organization.id);
  const eventData = (name: string, slug: string) => ({
    orgId: organization.id,
    name,
    slug: `${slug}-${suffix}`,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-08-01T16:00:00.000Z"),
    endsAt: new Date("2027-08-03T00:00:00.000Z"),
  });
  return Promise.all([
    client.event.create({ data: eventData("Invitation Summit", "invitation-summit") }),
    client.event.create({ data: eventData("Other Invitation Summit", "other-invitation-summit") }),
  ]);
}

async function createUser() {
  const suffix = randomUUID().slice(0, 8);
  const user = await client.user.create({
    data: {
      id: randomUUID(),
      name: "Riley Reviewer",
      email: `riley-${suffix}@example.test`,
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

before(async () => {
  await client.$connect();
});

after(async () => {
  await client.event.deleteMany({ where: { orgId: { in: createdOrganizationIds } } });
  await client.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
  await client.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await client.$disconnect();
});

describe("event invitations", () => {
  test("accepts reviewer and organizer invitations without crossing event or organization boundaries", async () => {
    const [event, otherEvent] = await createEventPair();
    const user = await createUser();
    let reviewerCallback = "";
    await service.invite(
      {
        eventId: event.id,
        email: user.email,
        displayName: user.name,
        role: EventMembershipRole.REVIEWER,
      },
      async ({ callbackURL }) => {
        reviewerCallback = callbackURL;
      },
    );
    await service.accept(tokenFromCallback(reviewerCallback), user);

    const [membership, reviewer, otherMembership, organizationMembership] = await Promise.all([
      client.eventMembership.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } } }),
      client.evaluationReviewer.findUnique({
        where: { eventId_identityId: { eventId: event.id, identityId: user.id } },
      }),
      client.eventMembership.findUnique({ where: { eventId_userId: { eventId: otherEvent.id, userId: user.id } } }),
      client.organizationMember.findFirst({ where: { userId: user.id } }),
    ]);
    assert.deepEqual(membership?.roles, [EventMembershipRole.REVIEWER]);
    assert.equal(membership?.status, MembershipStatus.ACTIVE);
    assert.equal(reviewer?.email, user.email);
    assert.equal(reviewer?.status, EvaluationReviewerStatus.ACTIVE);
    assert.equal(otherMembership, null);
    assert.equal(organizationMembership, null);

    let organizerCallback = "";
    await service.invite(
      { eventId: otherEvent.id, email: user.email, role: EventMembershipRole.ORGANIZER_ADMIN },
      async ({ callbackURL }) => {
        organizerCallback = callbackURL;
      },
    );
    await service.accept(tokenFromCallback(organizerCallback), user);
    const organizerMembership = await client.eventMembership.findUnique({
      where: { eventId_userId: { eventId: otherEvent.id, userId: user.id } },
    });
    assert.deepEqual(organizerMembership?.roles, [EventMembershipRole.ORGANIZER_ADMIN]);
    assert.equal(await client.organizationMember.findFirst({ where: { userId: user.id } }), null);
  });

  test("rotates resend tokens, rejects revoked invitations, and deactivates reviewer access", async () => {
    const [event] = await createEventPair();
    const user = await createUser();
    let originalCallback = "";
    await service.invite(
      { eventId: event.id, email: user.email, role: EventMembershipRole.REVIEWER },
      async ({ callbackURL }) => {
        originalCallback = callbackURL;
      },
    );
    const pending = await client.eventInvitation.findFirstOrThrow({
      where: { eventId: event.id, email: user.email, status: EventInvitationStatus.PENDING },
    });
    let replacementCallback = "";
    await service.resend(event.id, pending.id, async ({ callbackURL }) => {
      replacementCallback = callbackURL;
    });
    await assert.rejects(() => service.accept(tokenFromCallback(originalCallback), user), /invalid, expired, or/);
    await service.accept(tokenFromCallback(replacementCallback), user);

    const membership = await client.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
    });
    await service.setMembershipActive(event.id, membership.id, false);
    const [inactiveMembership, inactiveReviewer] = await Promise.all([
      client.eventMembership.findUniqueOrThrow({ where: { id: membership.id } }),
      client.evaluationReviewer.findUniqueOrThrow({
        where: { eventId_identityId: { eventId: event.id, identityId: user.id } },
      }),
    ]);
    assert.equal(inactiveMembership.status, MembershipStatus.REVOKED);
    assert.ok(inactiveMembership.revokedAt);
    assert.equal(inactiveReviewer.status, EvaluationReviewerStatus.INACTIVE);

    let revokedCallback = "";
    await service.invite(
      { eventId: event.id, email: user.email, role: EventMembershipRole.REVIEWER },
      async ({ callbackURL }) => {
        revokedCallback = callbackURL;
      },
    );
    const revocable = await client.eventInvitation.findFirstOrThrow({
      where: { eventId: event.id, email: user.email, status: EventInvitationStatus.PENDING },
    });
    await service.revoke(event.id, revocable.id);
    await assert.rejects(() => service.accept(tokenFromCallback(revokedCallback), user), /invalid, expired, or/);
  });
});
