import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { parseCfpDefinition } from "../../lib/cfp/index.ts";

export interface SpeakerPortalIdentity {
  readonly eventId: string;
  readonly speakerId: string;
}

const currentProfile = {
  orderBy: { versionNumber: "desc" as const },
  take: 1,
  select: {
    email: true,
    givenName: true,
    familyName: true,
    preferredName: true,
    pronouns: true,
    phone: true,
    organization: true,
    jobTitle: true,
    biography: true,
    websiteUrl: true,
    accessibilityNeeds: true,
    photoObjectKey: true,
    versionNumber: true,
  },
};

function displayName(profile: {
  readonly preferredName: string | null;
  readonly givenName: string;
  readonly familyName: string;
}) {
  return `${profile.preferredName ?? profile.givenName} ${profile.familyName}`;
}

function questionLabelsFromSnapshot(snapshot: Prisma.JsonValue): Map<string, string> {
  const parsed = parseCfpDefinition(snapshot);
  if (!parsed.ok) return new Map();
  return new Map(
    parsed.definition.sections.flatMap((section) => section.questions.map((question) => [question.id, question.label])),
  );
}

export class SpeakerPortalRepository {
  readonly #database: PrismaClient;

  constructor(database: PrismaClient) {
    this.#database = database;
  }

  async getProfile(identity: SpeakerPortalIdentity) {
    const profile = await this.#database.speakerProfileVersion.findFirst({
      where: { speakerId: identity.speakerId, speaker: { eventId: identity.eventId } },
      orderBy: { versionNumber: "desc" },
      select: currentProfile.select,
    });
    return profile ? { ...profile, displayName: displayName(profile) } : null;
  }

  async getDashboard(identity: SpeakerPortalIdentity) {
    const speaker = await this.#database.speaker.findFirst({
      where: { eventId: identity.eventId, id: identity.speakerId },
      select: {
        id: true,
        event: {
          select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
            startsAt: true,
            endsAt: true,
          },
        },
        profileVersions: currentProfile,
      },
    });
    const profile = speaker?.profileVersions[0];
    if (!speaker || !profile) return null;

    const [submissions, storedSessions, tasks, resources] = await Promise.all([
      this.#database.cfpSubmission.findMany({
        where: {
          eventId: identity.eventId,
          participants: { some: { speakerId: identity.speakerId } },
        },
        select: {
          id: true,
          kind: true,
          status: true,
          submittedAt: true,
          updatedAt: true,
          formVersion: { select: { title: true } },
          categories: {
            orderBy: { sortOrder: "asc" },
            select: { category: { select: { id: true, label: true } } },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
      this.#database.programSession.findMany({
        where: { eventId: identity.eventId, archivedAt: null },
        select: {
          id: true,
          agendaPlacement: { select: { startsAt: true, endsAt: true, room: { select: { name: true } } } },
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: {
              title: true,
              description: true,
              durationMinutes: true,
              participants: { orderBy: { sortOrder: "asc" }, select: { speakerId: true } },
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
      this.#database.speakerTaskAssignment.findMany({
        where: { eventId: identity.eventId, speakerId: identity.speakerId, status: { not: "WITHDRAWN" } },
        select: {
          id: true,
          status: true,
          assignedAt: true,
          dueAt: true,
          submittedAt: true,
          completedAt: true,
          definitionVersion: { select: { title: true, description: true, responseRequired: true } },
        },
        orderBy: [{ dueAt: "asc" }, { assignedAt: "asc" }, { id: "asc" }],
      }),
      this.#database.speakerResourcePage.findMany({
        where: {
          eventId: identity.eventId,
          archivedAt: null,
          versions: { some: { publishedAt: { not: null }, unpublishedAt: null } },
        },
        select: {
          id: true,
          versions: {
            where: { publishedAt: { not: null }, unpublishedAt: null },
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { slug: true, title: true, summary: true, sortOrder: true },
          },
        },
      }),
    ]);

    return {
      event: speaker.event,
      profile: { ...profile, displayName: displayName(profile) },
      submissions: submissions.map(({ categories, formVersion, ...submission }) => ({
        ...submission,
        title: formVersion.title,
        categories: categories.map(({ category }) => category),
      })),
      sessions: storedSessions.flatMap((session) => {
        const version = session.versions[0];
        if (!version?.participants.some(({ speakerId }) => speakerId === identity.speakerId)) return [];
        return [
          {
            id: session.id,
            agendaPlacement: session.agendaPlacement,
            title: version.title,
            description: version.description,
            durationMinutes: version.durationMinutes,
          },
        ];
      }),
      tasks,
      resources: resources
        .flatMap(({ id, versions }) => {
          const version = versions[0];
          return version ? [{ id, ...version }] : [];
        })
        .sort((left, right) => left.sortOrder - right.sortOrder),
    };
  }

  async getSubmission(identity: SpeakerPortalIdentity, submissionId: string) {
    const submission = await this.#database.cfpSubmission.findFirst({
      where: {
        eventId: identity.eventId,
        id: submissionId,
        participants: { some: { speakerId: identity.speakerId } },
      },
      select: {
        id: true,
        kind: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        formVersion: { select: { title: true } },
        categories: {
          orderBy: { sortOrder: "asc" },
          select: { category: { select: { id: true, label: true } } },
        },
        participants: {
          orderBy: { sortOrder: "asc" },
          select: {
            speaker: {
              select: {
                id: true,
                profileVersions: currentProfile,
              },
            },
          },
        },
        revisions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: {
            definitionSnapshot: true,
            answers: { orderBy: { sortOrder: "asc" }, select: { questionId: true, value: true } },
          },
        },
      },
    });
    if (!submission) return null;

    const revision = submission.revisions[0];
    const questionLabels = questionLabelsFromSnapshot(revision?.definitionSnapshot ?? null);

    return {
      id: submission.id,
      kind: submission.kind,
      status: submission.status,
      submittedAt: submission.submittedAt,
      updatedAt: submission.updatedAt,
      title: submission.formVersion.title,
      categories: submission.categories.map(({ category }) => category),
      participants: submission.participants.flatMap(({ speaker }) => {
        const profile = speaker.profileVersions[0];
        return profile
          ? [{ id: speaker.id, displayName: displayName(profile), organization: profile.organization }]
          : [];
      }),
      answers: (revision?.answers ?? []).map((answer) => ({
        ...answer,
        label: questionLabels.get(answer.questionId) ?? answer.questionId,
      })),
    };
  }

  async getTask(identity: SpeakerPortalIdentity, assignmentId: string) {
    return this.#database.speakerTaskAssignment.findFirst({
      where: {
        id: assignmentId,
        eventId: identity.eventId,
        speakerId: identity.speakerId,
        status: { not: "WITHDRAWN" },
      },
      select: {
        id: true,
        status: true,
        assignedAt: true,
        dueAt: true,
        submittedAt: true,
        completedAt: true,
        definitionVersion: {
          select: {
            title: true,
            description: true,
            responseRequired: true,
            responseSchema: true,
          },
        },
        submissions: {
          orderBy: { attemptNumber: "asc" },
          select: { attemptNumber: true, response: true, submittedAt: true },
        },
        transitions: {
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          select: { fromStatus: true, toStatus: true, note: true, occurredAt: true },
        },
      },
    });
  }
}
