import {
  EvaluationReviewerStatus,
  EventInvitationStatus,
  EventMembershipRole,
  MembershipStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { createHash, randomBytes } from "node:crypto";

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const inviteRoles = [EventMembershipRole.ORGANIZER_ADMIN, EventMembershipRole.REVIEWER] as const;

type InvitationRole = (typeof inviteRoles)[number];
type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export interface InvitationIdentity {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface CreateInvitationInput {
  readonly eventId: string;
  readonly email: string;
  readonly displayName?: string;
  readonly role: InvitationRole;
}

export type InvitationDelivery = (input: {
  readonly email: string;
  readonly name?: string;
  readonly callbackURL: string;
}) => Promise<void>;

export interface EventInvitationListItem {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: EventMembershipRole;
  readonly status: EventInvitationStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface EventMembershipListItem {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly EventMembershipRole[];
  readonly status: MembershipStatus;
}

export interface EventTeamSnapshot {
  readonly invitations: readonly EventInvitationListItem[];
  readonly memberships: readonly EventMembershipListItem[];
}

export interface EventInvitationPreview {
  readonly email: string;
  readonly eventName: string;
  readonly role: EventMembershipRole;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new RepositoryError("invalid-input", "Enter a valid email address.");
  }
  return normalized;
}

function optionalName(name: string | undefined): string | undefined {
  const normalized = name?.trim();
  return normalized ? normalized.slice(0, 120) : undefined;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function freshToken(): { readonly token: string; readonly hash: string; readonly expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token), expiresAt: new Date(Date.now() + invitationLifetimeMs) };
}

function invitationCallback(token: string): string {
  return `/invitations/${encodeURIComponent(token)}`;
}

function assertRole(role: EventMembershipRole): asserts role is InvitationRole {
  if (!inviteRoles.includes(role as InvitationRole)) {
    throw new RepositoryError("invalid-input", "Invite a reviewer or organizer staff member.");
  }
}

async function requireEvent(client: DatabaseClient, eventId: string): Promise<void> {
  const event = await client.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new RepositoryError("not-found", "The event was not found.");
}

export class EventInvitationService {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async list(eventId: string): Promise<EventTeamSnapshot> {
    await requireEvent(this.#client, eventId);
    const [invitations, memberships] = await Promise.all([
      this.#client.eventInvitation.findMany({
        where: { eventId },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      this.#client.eventMembership.findMany({
        where: { eventId },
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        select: { id: true, roles: true, status: true, user: { select: { email: true, name: true } } },
      }),
    ]);
    return {
      invitations,
      memberships: memberships.map(({ user, ...membership }) => ({
        ...membership,
        email: user.email,
        displayName: user.name,
      })),
    };
  }

  async preview(token: string): Promise<EventInvitationPreview | null> {
    const invitation = await this.#client.eventInvitation.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: { email: true, role: true, status: true, expiresAt: true, event: { select: { name: true } } },
    });
    if (!invitation || invitation.status !== EventInvitationStatus.PENDING || invitation.expiresAt <= new Date()) {
      return null;
    }
    return { email: invitation.email, eventName: invitation.event.name, role: invitation.role };
  }

  async invite(input: CreateInvitationInput, deliver: InvitationDelivery): Promise<void> {
    assertRole(input.role);
    const email = normalizeEmail(input.email);
    const displayName = optionalName(input.displayName);
    const existingUser = await this.#client.user.findUnique({
      where: { email },
      select: {
        eventMemberships: { where: { eventId: input.eventId, status: MembershipStatus.ACTIVE }, select: { id: true } },
      },
    });
    if (existingUser?.eventMemberships.length) {
      throw new RepositoryError("conflict", "That person already has active access to this event.");
    }

    const credential = freshToken();
    await this.#client.$transaction(async (transaction) => {
      await requireEvent(transaction, input.eventId);
      await transaction.eventInvitation.updateMany({
        where: { eventId: input.eventId, email, status: EventInvitationStatus.PENDING },
        data: { status: EventInvitationStatus.REVOKED },
      });
      await transaction.eventInvitation.create({
        data: {
          eventId: input.eventId,
          email,
          displayName,
          role: input.role,
          tokenHash: credential.hash,
          expiresAt: credential.expiresAt,
        },
      });
    });
    await deliver({ email, name: displayName, callbackURL: invitationCallback(credential.token) });
  }

  async resend(eventId: string, invitationId: string, deliver: InvitationDelivery): Promise<void> {
    const invitation = await this.#client.eventInvitation.findFirst({
      where: { id: invitationId, eventId, status: EventInvitationStatus.PENDING },
      select: { id: true, email: true, displayName: true },
    });
    if (!invitation) throw new RepositoryError("not-found", "That pending invitation was not found.");
    const credential = freshToken();
    await this.#client.eventInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash: credential.hash, expiresAt: credential.expiresAt },
    });
    await deliver({
      email: invitation.email,
      name: invitation.displayName ?? undefined,
      callbackURL: invitationCallback(credential.token),
    });
  }

  async revoke(eventId: string, invitationId: string): Promise<void> {
    const result = await this.#client.eventInvitation.updateMany({
      where: { id: invitationId, eventId, status: EventInvitationStatus.PENDING },
      data: { status: EventInvitationStatus.REVOKED },
    });
    if (result.count === 0) throw new RepositoryError("not-found", "That pending invitation was not found.");
  }

  async setMembershipActive(eventId: string, membershipId: string, active: boolean): Promise<void> {
    const membership = await this.#client.eventMembership.findFirst({
      where: { id: membershipId, eventId },
      select: { id: true, userId: true, roles: true },
    });
    if (!membership) throw new RepositoryError("not-found", "That event membership was not found.");
    await this.#client.$transaction(async (transaction) => {
      await transaction.eventMembership.update({
        where: { id: membership.id },
        data: {
          status: active ? MembershipStatus.ACTIVE : MembershipStatus.REVOKED,
          revokedAt: active ? null : new Date(),
        },
      });
      if (membership.roles.includes(EventMembershipRole.REVIEWER)) {
        await transaction.evaluationReviewer.updateMany({
          where: { eventId, identityId: membership.userId },
          data: { status: active ? EvaluationReviewerStatus.ACTIVE : EvaluationReviewerStatus.INACTIVE },
        });
      }
    });
  }

  async accept(
    token: string,
    identity: InvitationIdentity,
  ): Promise<{ readonly eventSlug: string; readonly role: EventMembershipRole }> {
    const hash = tokenHash(token);
    return this.#client.$transaction(async (transaction) => {
      const invitation = await transaction.eventInvitation.findUnique({
        where: { tokenHash: hash },
        include: { event: { select: { slug: true } } },
      });
      if (!invitation || invitation.status !== EventInvitationStatus.PENDING || invitation.expiresAt <= new Date()) {
        throw new RepositoryError("not-found", "This invitation is invalid, expired, or has already been used.");
      }
      if (normalizeEmail(identity.email) !== invitation.email) {
        throw new RepositoryError("invalid-input", "This invitation belongs to a different email address.");
      }

      const existingMembership = await transaction.eventMembership.findUnique({
        where: { eventId_userId: { eventId: invitation.eventId, userId: identity.id } },
        select: { roles: true },
      });
      const roles = [...new Set([...(existingMembership?.roles ?? []), invitation.role])];
      await transaction.eventMembership.upsert({
        where: { eventId_userId: { eventId: invitation.eventId, userId: identity.id } },
        create: { eventId: invitation.eventId, userId: identity.id, roles },
        update: { roles, status: MembershipStatus.ACTIVE, revokedAt: null },
      });

      if (invitation.role === EventMembershipRole.REVIEWER) {
        const reviewer = await transaction.evaluationReviewer.findFirst({
          where: { eventId: invitation.eventId, OR: [{ identityId: identity.id }, { email: invitation.email }] },
          select: { id: true },
        });
        if (reviewer) {
          await transaction.evaluationReviewer.update({
            where: { id: reviewer.id },
            data: {
              identityId: identity.id,
              email: invitation.email,
              displayName: invitation.displayName ?? identity.name,
              status: EvaluationReviewerStatus.ACTIVE,
            },
          });
        } else {
          await transaction.evaluationReviewer.create({
            data: {
              eventId: invitation.eventId,
              identityId: identity.id,
              email: invitation.email,
              displayName: invitation.displayName ?? identity.name,
            },
          });
        }
      }

      await transaction.eventInvitation.update({
        where: { id: invitation.id },
        data: { status: EventInvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });
      return { eventSlug: invitation.event.slug, role: invitation.role };
    });
  }
}
