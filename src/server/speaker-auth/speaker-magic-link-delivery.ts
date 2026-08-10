import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { SendMagicLink } from "@/server/auth/magic-link-email";

import { SpeakerAuthError, SpeakerAuthService } from "./speaker-auth.ts";

interface SpeakerMagicLinkDeliveryOptions {
  readonly baseUrl: string;
  readonly database: PrismaClient;
  readonly sendMagicLink: SendMagicLink;
}

interface SpeakerEmailRequest {
  readonly email: string;
  readonly eventSlug: string;
}

interface SpeakerRequest {
  readonly eventId: string;
  readonly speakerId: string;
}

const normalizedEmailSchema = z.email().transform((email) => email.trim().toLowerCase());

export class SpeakerMagicLinkDeliveryService {
  readonly #auth: SpeakerAuthService;
  readonly #baseUrl: string;
  readonly #database: PrismaClient;
  readonly #sendMagicLink: SendMagicLink;

  constructor(options: SpeakerMagicLinkDeliveryOptions) {
    this.#auth = new SpeakerAuthService({ database: options.database });
    this.#baseUrl = new URL(options.baseUrl).toString();
    this.#database = options.database;
    this.#sendMagicLink = options.sendMagicLink;
  }

  async requestForEmail(input: SpeakerEmailRequest): Promise<void> {
    const email = normalizedEmailSchema.safeParse(input.email);
    if (!email.success) return;

    const speaker = await this.#database.speaker.findFirst({
      where: { normalizedEmail: email.data, event: { slug: input.eventSlug } },
      select: {
        id: true,
        eventId: true,
        event: { select: { slug: true } },
        profileVersions: { orderBy: { versionNumber: "desc" }, take: 1, select: { email: true } },
      },
    });
    if (!speaker?.profileVersions[0]) return;

    await this.#issueAndDeliver({
      email: speaker.profileVersions[0].email,
      eventId: speaker.eventId,
      eventSlug: speaker.event.slug,
      speakerId: speaker.id,
    });
  }

  async resendForSpeaker(input: SpeakerRequest): Promise<void> {
    const speaker = await this.#database.speaker.findFirst({
      where: { eventId: input.eventId, id: input.speakerId },
      select: {
        id: true,
        eventId: true,
        event: { select: { slug: true } },
        profileVersions: { orderBy: { versionNumber: "desc" }, take: 1, select: { email: true } },
      },
    });
    if (!speaker?.profileVersions[0]) {
      throw new SpeakerAuthError("not-found", "Speaker not found in this event.");
    }

    await this.#issueAndDeliver({
      email: speaker.profileVersions[0].email,
      eventId: speaker.eventId,
      eventSlug: speaker.event.slug,
      speakerId: speaker.id,
    });
  }

  async #issueAndDeliver(
    input: SpeakerRequest & { readonly email: string; readonly eventSlug: string },
  ): Promise<void> {
    const link = await this.#auth.issueMagicLink(input);
    const url = new URL(`/portal/${encodeURIComponent(input.eventSlug)}/auth`, this.#baseUrl);
    url.searchParams.set("speakerId", input.speakerId);
    url.searchParams.set("token", link.token);
    await this.#sendMagicLink({ email: input.email, url: url.toString() });
  }
}
