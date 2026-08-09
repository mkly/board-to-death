import type {
  CfpSubmissionStatus,
  PrismaClient,
  ProgramSessionParticipantRole,
  SpeakerTaskAssignmentStatus,
} from "../../generated/prisma/client.ts";

export interface RecipientAudienceSelection {
  readonly speakerIds?: readonly string[];
  readonly acceptanceStatuses?: readonly CfpSubmissionStatus[];
  readonly sessionIds?: readonly string[];
  readonly participantRoles?: readonly ProgramSessionParticipantRole[];
  readonly categoryIds?: readonly string[];
  readonly onboardingStatuses?: readonly SpeakerTaskAssignmentStatus[];
  readonly tierIds?: readonly string[];
}

export interface RecipientAudienceMatch {
  readonly kind: "explicit" | "acceptance" | "session" | "role" | "category" | "onboarding" | "tier";
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
  readonly tiers: readonly { id: string; label: string; kind: "SPONSOR" | "EXHIBITOR" }[];
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

const PARTICIPANT_ROLE_LABELS: Record<ProgramSessionParticipantRole, string> = {
  SPEAKER: "Speaker role",
  MODERATOR: "Moderator role",
  CHAIRPERSON: "Chairperson role",
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
    const [speakers, sessions, categories, tiers] = await Promise.all([
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
      this.#client.contactGroupTier.findMany({
        where: { eventId },
        select: { id: true, name: true, kind: true },
        orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
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
      tiers: tiers.map((tier) => ({ id: tier.id, label: tier.name, kind: tier.kind })),
    };
  }

  async preview(eventId: string, selection: RecipientAudienceSelection): Promise<RecipientAudiencePreview> {
    const speakerIds = unique(selection.speakerIds);
    const acceptanceStatuses = [...new Set(selection.acceptanceStatuses ?? [])];
    const sessionIds = unique(selection.sessionIds);
    const participantRoles = [...new Set(selection.participantRoles ?? [])];
    const categoryIds = unique(selection.categoryIds);
    const onboardingStatuses = [...new Set(selection.onboardingStatuses ?? [])];
    const tierIds = unique(selection.tierIds);

    const [explicitSpeakers, acceptanceRows, sessions, roleSessions, categoryRows, onboardingRows, tierGroups] =
      await Promise.all([
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
        participantRoles.length === 0
          ? []
          : this.#client.programSession.findMany({
              where: { eventId, archivedAt: null },
              select: {
                versions: {
                  orderBy: { versionNumber: "desc" },
                  take: 1,
                  select: {
                    participants: {
                      where: { role: { in: participantRoles } },
                      select: { speakerId: true, role: true },
                    },
                  },
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
        tierIds.length === 0
          ? []
          : this.#client.contactGroup.findMany({
              where: {
                eventId,
                archivedAt: null,
                tierId: { in: tierIds },
                primaryContact: { archivedAt: null },
              },
              select: {
                primaryContact: {
                  select: { id: true, email: true, givenName: true, familyName: true },
                },
                tier: { select: { id: true, name: true, kind: true } },
              },
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
    for (const session of roleSessions) {
      for (const participant of session.versions[0]?.participants ?? []) {
        addMatch(participant.speakerId, {
          kind: "role",
          id: participant.role,
          label: PARTICIPANT_ROLE_LABELS[participant.role],
        });
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

    const contacts = new Map<string, RecipientAudienceMember>();
    for (const group of tierGroups) {
      const contact = group.primaryContact;
      const tier = group.tier;
      if (!contact || !tier) continue;
      const speakerId = `contact:${contact.id}`;
      const existing = contacts.get(contact.id);
      const match: RecipientAudienceMatch = {
        kind: "tier",
        id: tier.id,
        label: `${tier.kind === "SPONSOR" ? "Sponsor" : "Exhibitor"} tier: ${tier.name}`,
      };
      if (existing) {
        if (!existing.matches.some(({ kind, id }) => kind === match.kind && id === match.id)) {
          contacts.set(contact.id, { ...existing, matches: [...existing.matches, match] });
        }
      } else {
        contacts.set(contact.id, {
          speakerId,
          displayName: `${contact.givenName} ${contact.familyName}`,
          email: contact.email,
          matches: [match],
        });
      }
    }
    recipients.push(...[...contacts.values()].sort((left, right) => left.email.localeCompare(right.email)));

    return { recipients, excluded };
  }
}
