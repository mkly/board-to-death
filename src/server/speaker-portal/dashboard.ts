import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { parseCfpDefinition } from "../../lib/cfp/index.ts";
import { parsePortalFormAnswers, parsePortalFormDefinition } from "../../lib/portal-forms.ts";
import { LIST_BOUNDS } from "../database/list-bounds.ts";

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
    agreementObjectKey: true,
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

function confirmationHtml(message: string): string {
  const escaped = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  return `<p>${escaped}</p>`;
}

function questionLabelsFromSnapshot(snapshot: Prisma.JsonValue): Map<string, string> {
  const parsed = parseCfpDefinition(snapshot);
  if (!parsed.ok) return new Map();
  return new Map(
    parsed.definition.sections.flatMap((section) => section.questions.map((question) => [question.id, question.label])),
  );
}

/**
 * `allowedEmbedUrls` is nullable, and `SpeakerResourceRepository` keeps the
 * distinction: SQL NULL means the version never configured an allowlist, an
 * empty array means it configured one that permits nothing. Collapsing NULL to
 * `[]` here would strip every embed from resources authored before (or without)
 * per-resource configuration, so leave those to the global host allowlist.
 */
function embedUrls(value: Prisma.JsonValue): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((url): url is string => typeof url === "string");
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
        // The participant clause is a prefilter, not the decision: the dashboard
        // shows a session only when the *latest* version lists this speaker, and
        // that check still happens below. Without it this read loaded the whole
        // program on every dashboard render to keep a handful of rows.
        where: {
          eventId: identity.eventId,
          archivedAt: null,
          versions: { some: { participants: { some: { speakerId: identity.speakerId } } } },
        },
        take: LIST_BOUNDS.speakerPortalSessions,
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
          definitionVersion: {
            select: { title: true, description: true, responseRequired: true, responseSchema: true },
          },
        },
        orderBy: [{ dueAt: "asc" }, { assignedAt: "asc" }, { id: "asc" }],
      }),
      this.listResources(identity.eventId),
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
      resources,
    };
  }

  async getResources(identity: SpeakerPortalIdentity) {
    return this.listResources(identity.eventId);
  }

  async getResource(identity: SpeakerPortalIdentity, slug: string) {
    const resources = await this.listResources(identity.eventId);
    const index = resources.findIndex((resource) => resource.slug === slug);
    const resource = resources[index];
    if (!resource) return null;

    return {
      resource,
      previous: resources[index - 1] ?? null,
      next: resources[index + 1] ?? null,
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
            confirmedAt: true,
            slidesObjectKey: true,
            supportingDocumentObjectKey: true,
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
      participants: submission.participants.flatMap(
        ({ speaker, confirmedAt, slidesObjectKey, supportingDocumentObjectKey }) => {
          const profile = speaker.profileVersions[0];
          const isSelf = speaker.id === identity.speakerId;
          return profile
            ? [
                {
                  id: speaker.id,
                  displayName: displayName(profile),
                  organization: profile.organization,
                  isSelf,
                  confirmedAt,
                  slidesObjectKey: isSelf ? slidesObjectKey : null,
                  supportingDocumentObjectKey: isSelf ? supportingDocumentObjectKey : null,
                },
              ]
            : [];
        },
      ),
      answers: (revision?.answers ?? []).map((answer) => ({
        ...answer,
        label: questionLabels.get(answer.questionId) ?? answer.questionId,
      })),
    };
  }

  private async listResources(eventId: string) {
    const pages = await this.#database.speakerResourcePage.findMany({
      where: {
        eventId,
        archivedAt: null,
        versions: { some: { publishedAt: { not: null }, unpublishedAt: null } },
      },
      select: {
        id: true,
        versions: {
          where: { publishedAt: { not: null }, unpublishedAt: null },
          orderBy: { sortOrder: "asc" },
          take: 1,
          select: {
            slug: true,
            title: true,
            summary: true,
            bodyMarkdown: true,
            allowedEmbedUrls: true,
            sortOrder: true,
          },
        },
      },
    });

    return pages
      .flatMap(({ id, versions }) => {
        const version = versions[0];
        return version ? [{ id, ...version, allowedEmbedUrls: embedUrls(version.allowedEmbedUrls) }] : [];
      })
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  async getTask(identity: SpeakerPortalIdentity, assignmentId: string) {
    const assignment = await this.#database.speakerTaskAssignment.findFirst({
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
    if (!assignment) return null;
    const form = parsePortalFormDefinition(assignment.definitionVersion.responseSchema);
    if (!form) return { ...assignment, form: null, answers: {} };

    const answers = { ...parsePortalFormAnswers(assignment.submissions.at(-1)?.response) };
    const missingReusableFields = form.sections
      .flatMap(({ fields }) => fields)
      .filter(({ id, reusableKey }) => reusableKey && answers[id] === undefined);
    if (missingReusableFields.length > 0) {
      const previous = await this.#database.speakerTaskAssignment.findMany({
        where: {
          eventId: identity.eventId,
          speakerId: identity.speakerId,
          id: { not: assignmentId },
          submissions: { some: {} },
        },
        select: {
          definitionVersion: { select: { responseSchema: true } },
          submissions: { orderBy: { attemptNumber: "desc" }, take: 1, select: { response: true } },
        },
        orderBy: { updatedAt: "desc" },
      });
      const reusableAnswers = new Map<string, string | boolean>();
      for (const candidate of previous) {
        const candidateForm = parsePortalFormDefinition(candidate.definitionVersion.responseSchema);
        const candidateAnswers = parsePortalFormAnswers(candidate.submissions[0]?.response);
        for (const field of candidateForm?.sections.flatMap(({ fields }) => fields) ?? []) {
          const answer = candidateAnswers[field.id];
          if (field.reusableKey && answer !== undefined && !reusableAnswers.has(field.reusableKey)) {
            reusableAnswers.set(field.reusableKey, answer);
          }
        }
      }
      for (const field of missingReusableFields) {
        const answer = field.reusableKey ? reusableAnswers.get(field.reusableKey) : undefined;
        if (answer !== undefined) answers[field.id] = answer;
      }
    }
    return { ...assignment, form, answers };
  }

  async queueTaskConfirmation(identity: SpeakerPortalIdentity, assignmentId: string): Promise<boolean> {
    const assignment = await this.#database.speakerTaskAssignment.findFirst({
      where: { eventId: identity.eventId, id: assignmentId, speakerId: identity.speakerId, status: "SUBMITTED" },
      select: {
        id: true,
        definitionVersion: { select: { id: true, title: true, responseSchema: true } },
        speaker: {
          select: {
            profileVersions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { email: true, givenName: true, familyName: true, preferredName: true },
            },
          },
        },
      },
    });
    const form = parsePortalFormDefinition(assignment?.definitionVersion.responseSchema);
    const profile = assignment?.speaker.profileVersions[0];
    if (!assignment || !form?.confirmation.sendEmail || !profile) return false;

    const templateKey = `portal-form-confirmation-${assignment.definitionVersion.id}`;
    const template = await this.#database.communicationTemplate.upsert({
      where: { eventId_key: { eventId: identity.eventId, key: templateKey } },
      create: {
        eventId: identity.eventId,
        key: templateKey,
        name: `${assignment.definitionVersion.title} confirmation`,
        versions: {
          create: {
            version: 1,
            subjectTemplate: form.confirmation.subject,
            htmlTemplate: confirmationHtml(form.confirmation.message),
            textTemplate: form.confirmation.message,
          },
        },
      },
      update: {},
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const templateVersion = template.versions[0];
    if (!templateVersion) return false;
    const occurrenceKey = `portal-form-confirmation:${assignment.id}:1`;
    const created = await this.#database.messageDelivery.upsert({
      where: { eventId_occurrenceKey: { eventId: identity.eventId, occurrenceKey } },
      create: {
        eventId: identity.eventId,
        templateVersionId: templateVersion.id,
        idempotencyKey: occurrenceKey,
        occurrenceKey,
        recipients: {
          create: {
            recipientKey: `assignment:${assignment.id}`,
            email: profile.email,
            displayName: displayName(profile),
            subjectSnapshot: form.confirmation.subject,
            htmlSnapshot: confirmationHtml(form.confirmation.message),
            textSnapshot: form.confirmation.message,
          },
        },
      },
      update: {},
      select: { createdAt: true },
    });
    return Boolean(created);
  }
}
