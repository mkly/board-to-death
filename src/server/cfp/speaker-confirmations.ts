import {
  CfpSubmissionStatus,
  CfpSubmissionTransitionActor,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import type { ClockService, TokenGeneratorService } from "../infrastructure/index.ts";
import { createHash, randomBytes } from "node:crypto";

export const DEFAULT_SPEAKER_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

interface SpeakerConfirmationOptions {
  readonly clock?: ClockService;
  readonly database: PrismaClient;
  readonly invitationLifetimeMs?: number;
  readonly sessionLifetimeMs?: number;
  readonly tokenGenerator?: TokenGeneratorService;
}

export interface IssuedSpeakerConfirmationInvitation {
  readonly eventId: string;
  readonly submissionId: string;
  readonly speakerId: string;
  readonly email: string;
  readonly token: string;
  readonly expiresAt: Date;
}

export interface ConfirmSpeakerInvitationInput {
  readonly eventId: string;
  readonly submissionId: string;
  readonly speakerId: string;
  readonly token: string;
}

export interface ConfirmedSpeakerInvitation {
  readonly eventId: string;
  readonly submissionId: string;
  readonly speakerId: string;
  readonly submissionConfirmed: boolean;
  readonly assignmentsCreated: number;
  readonly sessionToken: string;
  readonly sessionExpiresAt: Date;
}

const systemClock: ClockService = { now: () => new Date() };
const secureTokenGenerator: TokenGeneratorService = {
  generate: ({ byteLength = 32 }) => ({ ok: true, value: randomBytes(byteLength).toString("base64url") }),
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function positiveDuration(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RepositoryError("invalid-input", `${field} must be a positive integer.`);
  }
  return value;
}

function generatedToken(generator: TokenGeneratorService, purpose: string): string {
  const result = generator.generate({ purpose, byteLength: 32 });
  if (!result.ok) throw new RepositoryError("conflict", `Unable to generate the ${purpose} token.`);
  return result.value;
}

function objectValue(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function stringList(value: Prisma.JsonValue | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function taskApplies(applicability: Prisma.JsonValue, sessionKinds: ReadonlySet<string>): boolean {
  const rules = objectValue(applicability);
  const requiredSessionKinds = stringList(rules?.sessionKinds);
  return requiredSessionKinds.length === 0 || requiredSessionKinds.some((kind) => sessionKinds.has(kind));
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") throw new RepositoryError("conflict", "The confirmation request was already applied.");
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned speaker confirmation record was not found.");
    }
  }
  throw error;
}

export class SpeakerConfirmationService {
  readonly #clock: ClockService;
  readonly #database: PrismaClient;
  readonly #invitationLifetimeMs: number;
  readonly #sessionLifetimeMs: number;
  readonly #tokenGenerator: TokenGeneratorService;

  constructor(options: SpeakerConfirmationOptions) {
    this.#clock = options.clock ?? systemClock;
    this.#database = options.database;
    this.#invitationLifetimeMs = positiveDuration(
      options.invitationLifetimeMs ?? DEFAULT_SPEAKER_INVITATION_LIFETIME_MS,
      "invitationLifetimeMs",
    );
    this.#sessionLifetimeMs = positiveDuration(
      options.sessionLifetimeMs ?? DEFAULT_SESSION_LIFETIME_MS,
      "sessionLifetimeMs",
    );
    this.#tokenGenerator = options.tokenGenerator ?? secureTokenGenerator;
  }

  async issueInvitations(eventId: string, submissionId: string): Promise<IssuedSpeakerConfirmationInvitation[]> {
    const now = this.#clock.now();
    try {
      return await this.#database.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`speaker-invitations:${submissionId}`}))`;
        const submission = await transaction.cfpSubmission.findFirst({
          where: { eventId, id: submissionId },
          select: {
            status: true,
            participants: {
              where: { confirmedAt: null },
              orderBy: { sortOrder: "asc" },
              select: {
                speakerId: true,
                speaker: {
                  select: {
                    profileVersions: {
                      orderBy: { versionNumber: "desc" },
                      take: 1,
                      select: { email: true },
                    },
                  },
                },
              },
            },
          },
        });
        if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
        if (submission.status !== CfpSubmissionStatus.ACCEPTED) {
          throw new RepositoryError("invalid-input", "Only accepted submissions can invite speakers.");
        }
        if (submission.participants.length === 0) {
          throw new RepositoryError("invalid-input", "Every participant has already confirmed this submission.");
        }

        const invitations: IssuedSpeakerConfirmationInvitation[] = [];
        for (const participant of submission.participants) {
          const profile = participant.speaker.profileVersions[0];
          if (!profile) throw new RepositoryError("invalid-input", "Every invited speaker must have a profile.");
          const token = generatedToken(this.#tokenGenerator, "speaker-confirmation");
          const expiresAt = new Date(now.getTime() + this.#invitationLifetimeMs);
          await transaction.cfpSpeakerInvitation.updateMany({
            where: { eventId, submissionId, speakerId: participant.speakerId, consumedAt: null },
            data: { consumedAt: now },
          });
          await transaction.cfpSpeakerInvitation.create({
            data: {
              eventId,
              submissionId,
              speakerId: participant.speakerId,
              tokenHash: hashToken(token),
              expiresAt,
            },
          });
          invitations.push({
            eventId,
            submissionId,
            speakerId: participant.speakerId,
            email: profile.email,
            token,
            expiresAt,
          });
        }
        return invitations;
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async confirm(input: ConfirmSpeakerInvitationInput): Promise<ConfirmedSpeakerInvitation> {
    const token = input.token.trim();
    if (token === "") throw new RepositoryError("invalid-input", "The confirmation token is required.");
    const now = this.#clock.now();
    const sessionToken = generatedToken(this.#tokenGenerator, "speaker-session");
    const sessionExpiresAt = new Date(now.getTime() + this.#sessionLifetimeMs);

    try {
      return await this.#database.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`speaker-confirmation:${input.submissionId}`}))`;
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`speaker-task-bootstrap:${input.eventId}:${input.speakerId}`}))`;
        const invitation = await transaction.cfpSpeakerInvitation.findFirst({
          where: {
            eventId: input.eventId,
            submissionId: input.submissionId,
            speakerId: input.speakerId,
            tokenHash: hashToken(token),
            consumedAt: null,
            expiresAt: { gt: now },
          },
          select: {
            id: true,
            participant: {
              select: {
                confirmedAt: true,
                submission: { select: { status: true } },
                speaker: {
                  select: {
                    programSessionParticipants: {
                      where: { sessionVersion: { session: { eventId: input.eventId, archivedAt: null } } },
                      select: { sessionVersion: { select: { session: { select: { kind: true } } } } },
                    },
                  },
                },
              },
            },
          },
        });
        if (!invitation || invitation.participant.confirmedAt) {
          throw new RepositoryError("invalid-input", "The confirmation link is invalid, expired, or already used.");
        }
        if (invitation.participant.submission.status !== CfpSubmissionStatus.ACCEPTED) {
          throw new RepositoryError("invalid-input", "Only invited speakers on accepted submissions can confirm.");
        }

        const claimed = await transaction.cfpSpeakerInvitation.updateMany({
          where: { id: invitation.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (claimed.count !== 1) {
          throw new RepositoryError("conflict", "The confirmation link was already used.");
        }
        const participant = await transaction.cfpSubmissionParticipant.updateMany({
          where: { submissionId: input.submissionId, speakerId: input.speakerId, confirmedAt: null },
          data: { confirmedAt: now },
        });
        if (participant.count !== 1) {
          throw new RepositoryError("conflict", "The speaker participation was already confirmed.");
        }

        const sessionKinds = new Set(
          invitation.participant.speaker.programSessionParticipants.map(
            ({ sessionVersion }) => sessionVersion.session.kind,
          ),
        );
        const definitions = await transaction.speakerTaskDefinition.findMany({
          where: { eventId: input.eventId, archivedAt: null },
          select: {
            id: true,
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { id: true, applicability: true, defaultDueOffsetDays: true },
            },
            assignments: {
              where: { speakerId: input.speakerId, status: { not: "WITHDRAWN" } },
              select: { id: true },
              take: 1,
            },
          },
        });
        let assignmentsCreated = 0;
        for (const definition of definitions) {
          const version = definition.versions[0];
          if (!version || definition.assignments.length > 0 || !taskApplies(version.applicability, sessionKinds)) {
            continue;
          }
          const dueAt =
            version.defaultDueOffsetDays === null
              ? null
              : new Date(now.getTime() + version.defaultDueOffsetDays * 86_400_000);
          await transaction.speakerTaskAssignment.create({
            data: {
              eventId: input.eventId,
              definitionId: definition.id,
              definitionVersionId: version.id,
              speakerId: input.speakerId,
              assignedAt: now,
              dueAt,
              transitions: { create: { toStatus: "PENDING", occurredAt: now } },
            },
          });
          assignmentsCreated += 1;
        }

        const remaining = await transaction.cfpSubmissionParticipant.count({
          where: { submissionId: input.submissionId, confirmedAt: null },
        });
        let submissionConfirmed = false;
        if (remaining === 0) {
          const confirmed = await transaction.cfpSubmission.updateMany({
            where: { eventId: input.eventId, id: input.submissionId, status: CfpSubmissionStatus.ACCEPTED },
            data: { status: CfpSubmissionStatus.CONFIRMED, confirmedAt: now },
          });
          if (confirmed.count !== 1) {
            throw new RepositoryError("conflict", "The submission changed while confirmation was applied.");
          }
          await transaction.cfpSubmissionTransition.create({
            data: {
              submissionId: input.submissionId,
              fromStatus: CfpSubmissionStatus.ACCEPTED,
              toStatus: CfpSubmissionStatus.CONFIRMED,
              actor: CfpSubmissionTransitionActor.SPEAKER_CONFIRMATION,
              actorId: input.speakerId,
              occurredAt: now,
            },
          });
          submissionConfirmed = true;
        }

        await transaction.speakerSession.deleteMany({
          where: { eventId: input.eventId, speakerId: input.speakerId },
        });
        await transaction.speakerSession.create({
          data: {
            eventId: input.eventId,
            speakerId: input.speakerId,
            tokenHash: hashToken(sessionToken),
            expiresAt: sessionExpiresAt,
          },
        });

        return {
          eventId: input.eventId,
          submissionId: input.submissionId,
          speakerId: input.speakerId,
          submissionConfirmed,
          assignmentsCreated,
          sessionToken,
          sessionExpiresAt,
        };
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
