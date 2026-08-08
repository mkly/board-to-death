import type { PrismaClient } from "@/generated/prisma/client";
import type { ClockService, TokenGeneratorService } from "@/server/infrastructure";

import { createHash, randomBytes } from "node:crypto";

const DEFAULT_LINK_LIFETIME_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type SpeakerAuthErrorCode = "invalid-input" | "invalid-token" | "not-found" | "token-generation-failed";

export class SpeakerAuthError extends Error {
  readonly code: SpeakerAuthErrorCode;

  constructor(code: SpeakerAuthErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SpeakerAuthError";
  }
}

interface SpeakerAuthOptions {
  readonly clock?: ClockService;
  readonly database: PrismaClient;
  readonly linkLifetimeMs?: number;
  readonly sessionLifetimeMs?: number;
  readonly tokenGenerator?: TokenGeneratorService;
}

interface SpeakerIdentity {
  readonly eventId: string;
  readonly speakerId: string;
}

interface ConsumeMagicLinkInput extends SpeakerIdentity {
  readonly token: string;
}

export interface IssuedSpeakerMagicLink extends SpeakerIdentity {
  readonly expiresAt: Date;
  readonly token: string;
}

export interface SpeakerSessionIdentity extends SpeakerIdentity {
  readonly expiresAt: Date;
  readonly sessionToken: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const systemClock: ClockService = { now: () => new Date() };
const secureTokenGenerator: TokenGeneratorService = {
  generate: ({ byteLength = 32 }) => ({ ok: true, value: randomBytes(byteLength).toString("base64url") }),
};

function requirePositiveDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SpeakerAuthError("invalid-input", `${name} must be a positive integer.`);
  }
  return value;
}

function requireToken(token: string): string {
  if (token.trim() === "") {
    throw new SpeakerAuthError("invalid-token", "The speaker authentication token is invalid.");
  }
  return token;
}

export class SpeakerAuthService {
  readonly #clock: ClockService;
  readonly #database: PrismaClient;
  readonly #linkLifetimeMs: number;
  readonly #sessionLifetimeMs: number;
  readonly #tokenGenerator: TokenGeneratorService;

  constructor(options: SpeakerAuthOptions) {
    this.#clock = options.clock ?? systemClock;
    this.#database = options.database;
    this.#linkLifetimeMs = requirePositiveDuration(
      options.linkLifetimeMs ?? DEFAULT_LINK_LIFETIME_MS,
      "linkLifetimeMs",
    );
    this.#sessionLifetimeMs = requirePositiveDuration(
      options.sessionLifetimeMs ?? DEFAULT_SESSION_LIFETIME_MS,
      "sessionLifetimeMs",
    );
    this.#tokenGenerator = options.tokenGenerator ?? secureTokenGenerator;
  }

  async issueMagicLink({ eventId, speakerId }: SpeakerIdentity): Promise<IssuedSpeakerMagicLink> {
    const generated = this.#tokenGenerator.generate({ purpose: "speaker-magic-link", byteLength: 32 });
    if (!generated.ok) {
      throw new SpeakerAuthError("token-generation-failed", "Unable to issue a speaker magic link.");
    }

    const token = generated.value;
    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + this.#linkLifetimeMs);

    await this.#database.$transaction(async (transaction) => {
      const speaker = await transaction.speaker.findUnique({ where: { eventId_id: { eventId, id: speakerId } } });
      if (!speaker) {
        throw new SpeakerAuthError("not-found", "Speaker not found in this event.");
      }

      await transaction.speakerMagicLink.updateMany({
        where: { eventId, speakerId, consumedAt: null },
        data: { consumedAt: now },
      });
      await transaction.speakerMagicLink.create({
        data: { eventId, speakerId, tokenHash: hashToken(token), expiresAt },
      });
    });

    return { eventId, speakerId, token, expiresAt };
  }

  async consumeMagicLink({
    eventId,
    speakerId,
    token: inputToken,
  }: ConsumeMagicLinkInput): Promise<SpeakerSessionIdentity> {
    const token = requireToken(inputToken);
    const generated = this.#tokenGenerator.generate({ purpose: "speaker-session", byteLength: 32 });
    if (!generated.ok) {
      throw new SpeakerAuthError("token-generation-failed", "Unable to establish a speaker session.");
    }

    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + this.#sessionLifetimeMs);
    const sessionToken = generated.value;
    const consumed = await this.#database.$transaction(async (transaction) => {
      const link = await transaction.speakerMagicLink.findFirst({
        where: { eventId, speakerId, tokenHash: hashToken(token), consumedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!link) return false;

      const claimed = await transaction.speakerMagicLink.updateMany({
        where: { id: link.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) return false;

      await transaction.speakerSession.deleteMany({ where: { eventId, speakerId } });
      await transaction.speakerSession.create({
        data: { eventId, speakerId, tokenHash: hashToken(sessionToken), expiresAt },
      });
      return true;
    });

    if (!consumed) {
      throw new SpeakerAuthError("invalid-token", "The speaker authentication token is invalid or expired.");
    }
    return { eventId, speakerId, sessionToken, expiresAt };
  }

  async getSession(inputToken: string): Promise<Omit<SpeakerSessionIdentity, "sessionToken"> | null> {
    const token = requireToken(inputToken);
    const now = this.#clock.now();
    const session = await this.#database.speakerSession.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session || session.expiresAt <= now) {
      if (session) await this.#database.speakerSession.deleteMany({ where: { id: session.id } });
      return null;
    }
    return { eventId: session.eventId, speakerId: session.speakerId, expiresAt: session.expiresAt };
  }

  async logout(inputToken: string): Promise<void> {
    const token = requireToken(inputToken);
    await this.#database.speakerSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
}
