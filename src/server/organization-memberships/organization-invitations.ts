import {
  MembershipStatus,
  OrganizationInvitationStatus,
  OrganizationMemberRole,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { createHash, randomBytes } from "node:crypto";

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1_000;

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export interface OrganizationInvitationIdentity {
  readonly id: string;
  readonly email: string;
}

export interface CreateOrganizationInvitationInput {
  readonly organizationId: string;
  readonly inviterId: string;
  readonly email: string;
  readonly role: OrganizationMemberRole;
}

export type OrganizationInvitationDelivery = (input: {
  readonly email: string;
  readonly callbackURL: string;
}) => Promise<void>;

export interface OrganizationInvitationListItem {
  readonly id: string;
  readonly email: string;
  readonly role: OrganizationMemberRole;
  readonly status: OrganizationInvitationStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface OrganizationMembershipListItem {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: OrganizationMemberRole;
  readonly status: MembershipStatus;
}

export interface OrganizationTeamSnapshot {
  readonly invitations: readonly OrganizationInvitationListItem[];
  readonly memberships: readonly OrganizationMembershipListItem[];
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new RepositoryError("invalid-input", "Enter a valid email address.");
  }
  return normalized;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function freshToken(): { readonly token: string; readonly hash: string; readonly expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token), expiresAt: new Date(Date.now() + invitationLifetimeMs) };
}

function invitationCallback(token: string): string {
  return `/organization-invitations/${encodeURIComponent(token)}`;
}

async function requireOrganization(client: DatabaseClient, organizationId: string): Promise<void> {
  const organization = await client.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) throw new RepositoryError("not-found", "The organization was not found.");
}

export class OrganizationInvitationService {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async list(organizationId: string): Promise<OrganizationTeamSnapshot> {
    await requireOrganization(this.#client, organizationId);
    const [invitations, memberships] = await Promise.all([
      this.#client.organizationInvitation.findMany({
        where: { orgId: organizationId },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        select: { id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true },
      }),
      this.#client.organizationMember.findMany({
        where: { orgId: organizationId },
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        select: { id: true, userId: true, role: true, status: true, user: { select: { email: true, name: true } } },
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

  async invite(input: CreateOrganizationInvitationInput, deliver: OrganizationInvitationDelivery): Promise<void> {
    const email = normalizeEmail(input.email);
    const existingUser = await this.#client.user.findUnique({
      where: { email },
      select: {
        organizationMemberships: {
          where: { orgId: input.organizationId, status: MembershipStatus.ACTIVE },
          select: { id: true },
        },
      },
    });
    if (existingUser?.organizationMemberships.length) {
      throw new RepositoryError("conflict", "That person is already an active member of this organization.");
    }

    const credential = freshToken();
    await this.#client.$transaction(async (transaction) => {
      await requireOrganization(transaction, input.organizationId);
      await transaction.organizationInvitation.updateMany({
        where: {
          orgId: input.organizationId,
          email,
          status: OrganizationInvitationStatus.PENDING,
        },
        data: { status: OrganizationInvitationStatus.REVOKED },
      });
      await transaction.organizationInvitation.create({
        data: {
          orgId: input.organizationId,
          inviterId: input.inviterId,
          email,
          role: input.role,
          tokenHash: credential.hash,
          expiresAt: credential.expiresAt,
        },
      });
    });
    await deliver({ email, callbackURL: invitationCallback(credential.token) });
  }

  async resend(organizationId: string, invitationId: string, deliver: OrganizationInvitationDelivery): Promise<void> {
    const invitation = await this.#client.organizationInvitation.findFirst({
      where: { id: invitationId, orgId: organizationId, status: OrganizationInvitationStatus.PENDING },
      select: { id: true, email: true },
    });
    if (!invitation) throw new RepositoryError("not-found", "That pending invitation was not found.");

    const credential = freshToken();
    await this.#client.organizationInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash: credential.hash, expiresAt: credential.expiresAt },
    });
    await deliver({ email: invitation.email, callbackURL: invitationCallback(credential.token) });
  }

  async revoke(organizationId: string, invitationId: string): Promise<void> {
    const result = await this.#client.organizationInvitation.updateMany({
      where: { id: invitationId, orgId: organizationId, status: OrganizationInvitationStatus.PENDING },
      data: { status: OrganizationInvitationStatus.REVOKED },
    });
    if (result.count === 0) throw new RepositoryError("not-found", "That pending invitation was not found.");
  }

  async setMembershipActive(organizationId: string, membershipId: string, active: boolean): Promise<void> {
    await this.#client.$transaction(async (transaction) => {
      const membership = await transaction.organizationMember.findFirst({
        where: { id: membershipId, orgId: organizationId },
        select: { id: true, role: true, status: true },
      });
      if (!membership) throw new RepositoryError("not-found", "That organization membership was not found.");

      if (
        !active &&
        membership.role === OrganizationMemberRole.OWNER &&
        membership.status === MembershipStatus.ACTIVE
      ) {
        const activeOwnerCount = await transaction.organizationMember.count({
          where: { orgId: organizationId, role: OrganizationMemberRole.OWNER, status: MembershipStatus.ACTIVE },
        });
        if (activeOwnerCount <= 1) {
          throw new RepositoryError("conflict", "Add another active owner before removing this owner's access.");
        }
      }

      await transaction.organizationMember.update({
        where: { id: membership.id },
        data: {
          status: active ? MembershipStatus.ACTIVE : MembershipStatus.REVOKED,
          revokedAt: active ? null : new Date(),
        },
      });
    });
  }

  async accept(
    token: string,
    identity: OrganizationInvitationIdentity,
  ): Promise<{ readonly organizationId: string; readonly role: OrganizationMemberRole }> {
    const hash = tokenHash(token);
    return this.#client.$transaction(async (transaction) => {
      const invitation = await transaction.organizationInvitation.findUnique({ where: { tokenHash: hash } });
      if (
        !invitation ||
        invitation.status !== OrganizationInvitationStatus.PENDING ||
        invitation.expiresAt <= new Date()
      ) {
        throw new RepositoryError("not-found", "This invitation is invalid, expired, or has already been used.");
      }
      if (normalizeEmail(identity.email) !== invitation.email) {
        throw new RepositoryError("invalid-input", "This invitation belongs to a different email address.");
      }

      await transaction.organizationMember.upsert({
        where: { orgId_userId: { orgId: invitation.orgId, userId: identity.id } },
        create: { orgId: invitation.orgId, userId: identity.id, role: invitation.role },
        update: { role: invitation.role, status: MembershipStatus.ACTIVE, revokedAt: null },
      });
      await transaction.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: OrganizationInvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });
      return { organizationId: invitation.orgId, role: invitation.role };
    });
  }
}
