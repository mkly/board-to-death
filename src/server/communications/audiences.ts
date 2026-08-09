import type { CfpSubmissionStatus, PrismaClient, SpeakerTaskAssignmentStatus } from "../../generated/prisma/client.ts";

export interface RecipientAudienceSelection {
  readonly speakerIds?: readonly string[];
  readonly acceptanceStatuses?: readonly CfpSubmissionStatus[];
  readonly sessionIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  readonly onboardingStatuses?: readonly SpeakerTaskAssignmentStatus[];
}

export interface RecipientAudienceMatch {
  readonly kind: "explicit" | "acceptance" | "session" | "category" | "onboarding";
  readonly id: string;
  readonly label: string;
}

export interface RecipientAudienceMember {
  readonly speakerId: string;
  readonly displayName: string;
  readonly email: string;
  readonly matches: readonly RecipientAudienceMatch[];
}

export interface ExcludedRecipientAudienceMember extends RecipientAudienceMember {
  readonly reason: "email-opt-out" | "missing-profile";
  readonly explanation: string;
}

export interface RecipientAudiencePreview {
  readonly recipients: readonly RecipientAudienceMember[];
  readonly excluded: readonly ExcludedRecipientAudienceMember[];
}

export interface RecipientAudienceOptions {
  readonly speakers: readonly { id: string; name: string; email: string }[];
  readonly sessions: readonly { id: string; title: string }[];
  readonly categories: readonly { id: string; label: string }[];
}

const ACCEPTANCE_LABELS: Record<CfpSubmissionStatus, string> = {
  DRAFT: "Draft submission",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  WAITLISTED: "Waitlisted",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  CONFIRMED: "Confirmed",
};

const ONBOARDING_LABELS: Record<SpeakerTaskAssignmentStatus, string> = {
  PENDING: "Onboarding pending",
  SUBMITTED: "Onboarding submitted",
  APPROVED: "Onboarding approved",
  REVISION_REQUESTED: "Onboarding revision requested",
  WITHDRAWN: "Onboarding withdrawn",
};

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function profileName(profile: { givenName: string; familyName: string; preferredName: string | null }): string {
  return `${profile.preferredName ?? profile.givenName} ${profile.familyName}`;
}

export class RecipientAudienceRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async listOptions(eventId: string): Promise<RecipientAudienceOptions> {
    const [speakers, sessions, categories] = await Promise.all([
      this.#client.speaker.findMany({
        where: { eventId },
        select: {
          id: true,
          normalizedEmail: true,
          profileVersions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { givenName: true, familyName: true, preferredName: true, email: true },
          },
        },
        orderBy: { normalizedEmail: "asc" },
      }),
      this.#client.programSession.findMany({
        where: { eventId, archivedAt: null },
        select: {
          id: true,
          versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { title: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.#client.cfpCategory.findMany({
        where: { eventId },
        select: { id: true, label: true },
        orderBy: { label: "asc" },
      }),
    ]);

    return {
      speakers: speakers.flatMap((speaker) => {
        const profile = speaker.profileVersions[0];
        return profile ? [{ id: speaker.id, name: profileName(profile), email: profile.email }] : [];
      }),
      sessions: sessions.flatMap((session) => {
        const version = session.versions[0];
        return version ? [{ id: session.id, title: version.title }] : [];
      }),
      categories,
    };
  }

  async preview(eventId: string, selection: RecipientAudienceSelection): Promise<RecipientAudiencePreview> {
    const speakerIds = unique(selection.speakerIds);
    const acceptanceStatuses = [...new Set(selection.acceptanceStatuses ?? [])];
    const sessionIds = unique(selection.sessionIds);
    const categoryIds = unique(selection.categoryIds);
    const onboardingStatuses = [...new Set(selection.onboardingStatuses ?? [])];

    const [explicitSpeakers, acceptanceRows, sessions, categoryRows, onboardingRows] = await Promise.all([
      speakerIds.length === 0
        ? []
        : this.#client.speaker.findMany({ where: { eventId, id: { in: speakerIds } }, select: { id: true } }),
      acceptanceStatuses.length === 0
        ? []
        : this.#client.cfpSubmissionParticipant.findMany({
            where: { eventId, submission: { eventId, status: { in: acceptanceStatuses } } },
            select: { speakerId: true, submission: { select: { status: true } } },
          }),
      sessionIds.length === 0
        ? []
        : this.#client.programSession.findMany({
            where: { eventId, id: { in: sessionIds }, archivedAt: null },
            select: {
              id: true,
              versions: {
                orderBy: { versionNumber: "desc" },
                take: 1,
                select: { title: true, participants: { select: { speakerId: true } } },
              },
            },
          }),
      categoryIds.length === 0
        ? []
        : this.#client.cfpSubmissionParticipant.findMany({
            where: {
              eventId,
              submission: { eventId, categories: { some: { categoryId: { in: categoryIds } } } },
            },
            select: {
              speakerId: true,
              submission: {
                select: {
                  categories: {
                    where: { categoryId: { in: categoryIds } },
                    select: { category: { select: { id: true, label: true } } },
                  },
                },
              },
            },
          }),
      onboardingStatuses.length === 0
        ? []
        : this.#client.speakerTaskAssignment.findMany({
            where: { eventId, status: { in: onboardingStatuses } },
            select: { speakerId: true, status: true },
          }),
    ]);

    const matchesBySpeaker = new Map<string, Map<string, RecipientAudienceMatch>>();
    const addMatch = (speakerId: string, match: RecipientAudienceMatch) => {
      const matches = matchesBySpeaker.get(speakerId) ?? new Map<string, RecipientAudienceMatch>();
      matches.set(`${match.kind}:${match.id}`, match);
      matchesBySpeaker.set(speakerId, matches);
    };

    for (const speaker of explicitSpeakers) {
      addMatch(speaker.id, { kind: "explicit", id: speaker.id, label: "Selected directly" });
    }
    for (const row of acceptanceRows) {
      addMatch(row.speakerId, {
        kind: "acceptance",
        id: row.submission.status,
        label: ACCEPTANCE_LABELS[row.submission.status],
      });
    }
    for (const session of sessions) {
      const version = session.versions[0];
      if (!version) continue;
      for (const participant of version.participants) {
        addMatch(participant.speakerId, { kind: "session", id: session.id, label: version.title });
      }
    }
    for (const row of categoryRows) {
      for (const { category } of row.submission.categories) {
        addMatch(row.speakerId, { kind: "category", id: category.id, label: category.label });
      }
    }
    for (const row of onboardingRows) {
      addMatch(row.speakerId, {
        kind: "onboarding",
        id: row.status,
        label: ONBOARDING_LABELS[row.status],
      });
    }

    const candidates = await this.#client.speaker.findMany({
      where: { eventId, id: { in: [...matchesBySpeaker.keys()] } },
      select: {
        id: true,
        normalizedEmail: true,
        profileVersions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: {
            email: true,
            givenName: true,
            familyName: true,
            preferredName: true,
            consentToReceiveEmail: true,
          },
        },
      },
      orderBy: { normalizedEmail: "asc" },
    });

    const recipients: RecipientAudienceMember[] = [];
    const excluded: ExcludedRecipientAudienceMember[] = [];
    for (const candidate of candidates) {
      const matches = [...(matchesBySpeaker.get(candidate.id)?.values() ?? [])];
      const profile = candidate.profileVersions[0];
      if (!profile) {
        excluded.push({
          speakerId: candidate.id,
          displayName: "Unknown speaker",
          email: candidate.normalizedEmail,
          matches,
          reason: "missing-profile",
          explanation: "No current speaker profile is available.",
        });
        continue;
      }
      const member = {
        speakerId: candidate.id,
        displayName: profileName(profile),
        email: profile.email,
        matches,
      };
      if (!profile.consentToReceiveEmail) {
        excluded.push({
          ...member,
          reason: "email-opt-out",
          explanation: "Email consent is not active for this speaker.",
        });
        continue;
      }
      recipients.push(member);
    }

    return { recipients, excluded };
  }
}
