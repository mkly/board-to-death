import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface SpeakerProfileInput {
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly preferredName?: string | null;
  readonly pronouns?: string | null;
  readonly phone?: string | null;
  readonly organization?: string | null;
  readonly jobTitle?: string | null;
  readonly biography?: string | null;
  readonly websiteUrl?: string | null;
  readonly accessibilityNeeds?: string | null;
  readonly photoObjectKey?: string | null;
  readonly agreementObjectKey?: string | null;
  readonly consentToPublishProfile?: boolean;
  readonly consentToReceiveEmail?: boolean;
  readonly consentedAt?: Date | null;
}

export interface CreateSpeakerInput extends SpeakerProfileInput {
  readonly eventId: string;
}

export type UpdateSpeakerProfileInput = Partial<SpeakerProfileInput>;

export interface PersistedSpeakerProfile extends Required<Omit<SpeakerProfileInput, "consentedAt">> {
  readonly id: string;
  readonly versionNumber: number;
  readonly consentedAt: Date | null;
  readonly createdAt: Date;
}

export interface PersistedSpeaker {
  readonly id: string;
  readonly eventId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly profile: PersistedSpeakerProfile;
  readonly profileVersions: readonly PersistedSpeakerProfile[];
}

export interface PersistedSubmissionParticipant {
  readonly sortOrder: number;
  readonly speaker: PersistedSpeaker;
  readonly slidesObjectKey: string | null;
  readonly supportingDocumentObjectKey: string | null;
}

export interface UpdateSubmissionParticipantFilesInput {
  readonly slidesObjectKey?: string | null;
  readonly supportingDocumentObjectKey?: string | null;
}

export interface ValidatedSpeakerProfile {
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly preferredName: string | null;
  readonly pronouns: string | null;
  readonly phone: string | null;
  readonly organization: string | null;
  readonly jobTitle: string | null;
  readonly biography: string | null;
  readonly websiteUrl: string | null;
  readonly accessibilityNeeds: string | null;
  readonly photoObjectKey: string | null;
  readonly agreementObjectKey: string | null;
  readonly consentToPublishProfile: boolean;
  readonly consentToReceiveEmail: boolean;
  readonly consentedAt: Date | null;
}

const speakerInclude = {
  profileVersions: { orderBy: { versionNumber: "asc" } },
} as const satisfies Prisma.SpeakerInclude;

type StoredSpeaker = Prisma.SpeakerGetPayload<{ include: typeof speakerInclude }>;

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizeEmail(value: string): string {
  const email = requiredText(value, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid("email must be a valid email address.");
  return email;
}

function normalizeUrl(value: string | null | undefined): string | null {
  const normalized = optionalText(value);
  if (normalized === null) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    invalid("websiteUrl must be a valid HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    invalid("websiteUrl must be a valid HTTP or HTTPS URL.");
  }
  return url.toString();
}

export function validateSpeakerProfileInput(input: SpeakerProfileInput): ValidatedSpeakerProfile {
  const consentToPublishProfile = input.consentToPublishProfile ?? false;
  const consentToReceiveEmail = input.consentToReceiveEmail ?? false;
  const consentedAt =
    input.consentedAt === undefined || input.consentedAt === null ? null : new Date(input.consentedAt);
  if (consentedAt !== null && !Number.isFinite(consentedAt.getTime())) invalid("consentedAt must be a valid date.");
  if ((consentToPublishProfile || consentToReceiveEmail) && consentedAt === null) {
    invalid("consentedAt is required when speaker consent is granted.");
  }
  return {
    email: normalizeEmail(input.email),
    givenName: requiredText(input.givenName, "givenName"),
    familyName: requiredText(input.familyName, "familyName"),
    preferredName: optionalText(input.preferredName),
    pronouns: optionalText(input.pronouns),
    phone: optionalText(input.phone),
    organization: optionalText(input.organization),
    jobTitle: optionalText(input.jobTitle),
    biography: optionalText(input.biography),
    websiteUrl: normalizeUrl(input.websiteUrl),
    accessibilityNeeds: optionalText(input.accessibilityNeeds),
    photoObjectKey: optionalText(input.photoObjectKey),
    agreementObjectKey: optionalText(input.agreementObjectKey),
    consentToPublishProfile,
    consentToReceiveEmail,
    consentedAt,
  };
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError(
        "conflict",
        "The event-scoped speaker, profile version, or participant order already exists.",
      );
    }
    if (code === "P2003") {
      throw new RepositoryError("conflict", "A speaker that is still assigned to a submission cannot be deleted.");
    }
    if (code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned speaker record was not found.");
    }
  }
  throw error;
}

function fromStored(stored: StoredSpeaker): PersistedSpeaker {
  const versions = stored.profileVersions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    email: version.email,
    givenName: version.givenName,
    familyName: version.familyName,
    preferredName: version.preferredName,
    pronouns: version.pronouns,
    phone: version.phone,
    organization: version.organization,
    jobTitle: version.jobTitle,
    biography: version.biography,
    websiteUrl: version.websiteUrl,
    accessibilityNeeds: version.accessibilityNeeds,
    photoObjectKey: version.photoObjectKey,
    agreementObjectKey: version.agreementObjectKey,
    consentToPublishProfile: version.consentToPublishProfile,
    consentToReceiveEmail: version.consentToReceiveEmail,
    consentedAt: version.consentedAt,
    createdAt: version.createdAt,
  }));
  const profile = versions.at(-1);
  if (!profile) throw new Error(`Speaker ${stored.id} has no profile version.`);
  return {
    id: stored.id,
    eventId: stored.eventId,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    profile,
    profileVersions: versions,
  };
}

function profileInput(profile: PersistedSpeakerProfile): SpeakerProfileInput {
  return {
    email: profile.email,
    givenName: profile.givenName,
    familyName: profile.familyName,
    preferredName: profile.preferredName,
    pronouns: profile.pronouns,
    phone: profile.phone,
    organization: profile.organization,
    jobTitle: profile.jobTitle,
    biography: profile.biography,
    websiteUrl: profile.websiteUrl,
    accessibilityNeeds: profile.accessibilityNeeds,
    photoObjectKey: profile.photoObjectKey,
    agreementObjectKey: profile.agreementObjectKey,
    consentToPublishProfile: profile.consentToPublishProfile,
    consentToReceiveEmail: profile.consentToReceiveEmail,
    consentedAt: profile.consentedAt,
  };
}

export class SpeakerRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async create(input: CreateSpeakerInput): Promise<PersistedSpeaker> {
    const profile = validateSpeakerProfileInput(input);
    try {
      const speaker = await this.client.speaker.create({
        data: {
          eventId: input.eventId,
          normalizedEmail: profile.email,
          profileVersions: { create: { versionNumber: 1, ...profile } },
        },
        include: speakerInclude,
      });
      return fromStored(speaker);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async get(eventId: string, speakerId: string): Promise<PersistedSpeaker | null> {
    const speaker = await this.client.speaker.findFirst({ where: { eventId, id: speakerId }, include: speakerInclude });
    return speaker ? fromStored(speaker) : null;
  }

  async list(eventId: string): Promise<PersistedSpeaker[]> {
    const speakers = await this.client.speaker.findMany({
      where: { eventId },
      include: speakerInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return speakers.map(fromStored);
  }

  async updateProfile(
    eventId: string,
    speakerId: string,
    input: UpdateSpeakerProfileInput,
    expectedVersionNumber?: number,
  ): Promise<PersistedSpeaker> {
    try {
      await this.client.$transaction(async (transaction) => {
        const current = await transaction.speaker.findFirst({
          where: { eventId, id: speakerId },
          include: { profileVersions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        });
        if (!current?.profileVersions[0]) {
          throw new RepositoryError("not-found", "The event-owned speaker was not found.");
        }
        const previous = fromStored({ ...current, profileVersions: [...current.profileVersions].reverse() });
        if (expectedVersionNumber !== undefined && previous.profile.versionNumber !== expectedVersionNumber) {
          throw new RepositoryError("conflict", "The speaker profile changed after this form was loaded.");
        }
        const profile = validateSpeakerProfileInput({ ...profileInput(previous.profile), ...input });
        await transaction.speaker.update({
          where: { id: speakerId },
          data: {
            normalizedEmail: profile.email,
            profileVersions: {
              create: { versionNumber: previous.profile.versionNumber + 1, ...profile },
            },
          },
        });
      });
      return await this.require(eventId, speakerId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async replaceSubmissionParticipants(
    eventId: string,
    submissionId: string,
    orderedSpeakerIds: readonly string[],
  ): Promise<PersistedSubmissionParticipant[]> {
    if (new Set(orderedSpeakerIds).size !== orderedSpeakerIds.length) {
      invalid("orderedSpeakerIds must contain each speaker at most once.");
    }
    try {
      await this.client.$transaction(async (transaction) => {
        const submission = await transaction.cfpSubmission.findFirst({
          where: { eventId, id: submissionId },
          select: { id: true },
        });
        if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
        const count = await transaction.speaker.count({
          where: { eventId, id: { in: [...orderedSpeakerIds] } },
        });
        if (count !== orderedSpeakerIds.length) {
          throw new RepositoryError("not-found", "Every participant must be a speaker in the submission event.");
        }
        await transaction.cfpSubmissionParticipant.deleteMany({ where: { submissionId } });
        if (orderedSpeakerIds.length > 0) {
          await transaction.cfpSubmissionParticipant.createMany({
            data: orderedSpeakerIds.map((speakerId, sortOrder) => ({ eventId, submissionId, speakerId, sortOrder })),
          });
        }
      });
      return await this.listSubmissionParticipants(eventId, submissionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async listSubmissionParticipants(eventId: string, submissionId: string): Promise<PersistedSubmissionParticipant[]> {
    const submission = await this.client.cfpSubmission.findFirst({
      where: { eventId, id: submissionId },
      select: { id: true },
    });
    if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
    const participants = await this.client.cfpSubmissionParticipant.findMany({
      where: { eventId, submissionId },
      orderBy: { sortOrder: "asc" },
      include: { speaker: { include: speakerInclude } },
    });
    return participants.map(({ sortOrder, speaker, slidesObjectKey, supportingDocumentObjectKey }) => ({
      sortOrder,
      speaker: fromStored(speaker),
      slidesObjectKey,
      supportingDocumentObjectKey,
    }));
  }

  async getSubmissionParticipant(
    eventId: string,
    submissionId: string,
    speakerId: string,
  ): Promise<PersistedSubmissionParticipant | null> {
    const participant = await this.client.cfpSubmissionParticipant.findFirst({
      where: { eventId, submissionId, speakerId },
      include: { speaker: { include: speakerInclude } },
    });
    if (!participant) return null;
    const { sortOrder, speaker, slidesObjectKey, supportingDocumentObjectKey } = participant;
    return { sortOrder, speaker: fromStored(speaker), slidesObjectKey, supportingDocumentObjectKey };
  }

  // Targets a single row, unlike replaceSubmissionParticipants, so a reorder never discards file keys.
  async updateSubmissionParticipantFiles(
    eventId: string,
    submissionId: string,
    speakerId: string,
    input: UpdateSubmissionParticipantFilesInput,
  ): Promise<PersistedSubmissionParticipant> {
    try {
      const data: Prisma.CfpSubmissionParticipantUpdateManyMutationInput = {};
      if ("slidesObjectKey" in input) data.slidesObjectKey = optionalText(input.slidesObjectKey);
      if ("supportingDocumentObjectKey" in input) {
        data.supportingDocumentObjectKey = optionalText(input.supportingDocumentObjectKey);
      }
      const updated = await this.client.cfpSubmissionParticipant.updateMany({
        where: { eventId, submissionId, speakerId },
        data,
      });
      if (updated.count === 0) {
        throw new RepositoryError("not-found", "The event-owned submission participant was not found.");
      }
    } catch (error) {
      return mapDatabaseError(error);
    }
    const participant = await this.getSubmissionParticipant(eventId, submissionId, speakerId);
    if (!participant) throw new RepositoryError("not-found", "The event-owned submission participant was not found.");
    return participant;
  }

  async delete(eventId: string, speakerId: string): Promise<void> {
    try {
      const deleted = await this.client.speaker.deleteMany({ where: { eventId, id: speakerId } });
      if (deleted.count === 0) throw new RepositoryError("not-found", "The event-owned speaker was not found.");
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  private async require(eventId: string, speakerId: string): Promise<PersistedSpeaker> {
    const speaker = await this.get(eventId, speakerId);
    if (!speaker) throw new RepositoryError("not-found", "The event-owned speaker was not found.");
    return speaker;
  }
}
