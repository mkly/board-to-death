import {
  type CfpCategory,
  type CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  CfpSubmissionTransitionActor,
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { type CfpFormDefinition, parseCfpDefinition } from "../../lib/cfp/index.ts";
import { resolvePersonIdentity } from "../contacts/person-identity.ts";
import { RepositoryError } from "../events/repositories.ts";
import { type SpeakerProfileInput, validateSpeakerProfileInput } from "../speakers/repositories.ts";
import { cfpDefinitionInputFromStored } from "./definition.ts";
import type { CfpSubmissionLimits } from "./policies.ts";

export interface CreateCfpCategoryInput {
  readonly eventId: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string | null;
}

export interface CfpSubmissionAnswerInput {
  readonly questionId: string;
  readonly value: unknown;
}

export interface CfpSubmissionParticipantInput {
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly phone?: string;
  readonly biography?: string;
  readonly consent?: boolean;
}

export interface CreateCfpSubmissionDraftInput {
  readonly eventId: string;
  readonly formVersionId: string;
  readonly kind: CfpSubmissionKind;
  readonly answers: readonly CfpSubmissionAnswerInput[];
  readonly categoryIds?: readonly string[];
  readonly participants?: readonly CfpSubmissionParticipantInput[];
}

export interface CreateFinalizedCfpSubmissionInput extends CreateCfpSubmissionDraftInput {
  readonly idempotencyKey: string;
}

export interface SaveCfpSubmissionDraftInput {
  readonly answers: readonly CfpSubmissionAnswerInput[];
  readonly categoryIds?: readonly string[];
}

export interface CfpSubmissionRevisionSnapshot {
  readonly id: string;
  readonly versionNumber: number;
  readonly kind: CfpSubmissionRevisionKind;
  readonly formVersionId: string;
  readonly definition: CfpFormDefinition;
  readonly answers: readonly {
    readonly questionId: string;
    readonly value: unknown;
  }[];
  readonly createdAt: Date;
}

export interface PersistedCfpSubmission {
  readonly id: string;
  readonly eventId: string;
  readonly formVersionId: string;
  readonly kind: CfpSubmissionKind;
  readonly status: CfpSubmissionStatus;
  readonly submittedAt: Date | null;
  readonly reviewStartedAt: Date | null;
  readonly decidedAt: Date | null;
  readonly confirmedAt: Date | null;
  readonly categoryIds: readonly string[];
  readonly revisions: readonly CfpSubmissionRevisionSnapshot[];
  readonly transitions: readonly {
    readonly fromStatus: CfpSubmissionStatus | null;
    readonly toStatus: CfpSubmissionStatus;
    readonly actor: CfpSubmissionTransitionActor;
    readonly actorId: string | null;
    readonly note: string | null;
    readonly occurredAt: Date;
  }[];
}

export interface CfpSubmissionDetail {
  readonly id: string;
  readonly kind: CfpSubmissionKind;
  readonly status: CfpSubmissionStatus;
  readonly submittedAt: Date | null;
  readonly reviewStartedAt: Date | null;
  readonly decidedAt: Date | null;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly event: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly timezone: string;
  };
  readonly categories: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly participants: readonly {
    readonly sortOrder: number;
    readonly speaker: {
      readonly id: string;
      readonly email: string;
      readonly givenName: string;
      readonly familyName: string;
      readonly preferredName: string | null;
      readonly pronouns: string | null;
      readonly organization: string | null;
      readonly jobTitle: string | null;
    };
  }[];
  readonly revision: CfpSubmissionRevisionSnapshot | null;
}

export interface CfpSubmissionListQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly search?: string;
  readonly status?: CfpSubmissionStatus;
  readonly kind?: CfpSubmissionKind;
  readonly categoryId?: string;
  readonly assigneeId?: string;
  readonly sortBy?: CfpSubmissionSortKey;
  readonly sortDirection?: "asc" | "desc";
  readonly all?: boolean;
}

export type CfpSubmissionSortKey = "submittedAt" | "updatedAt" | "status" | "formTitle";

export interface CfpSubmissionListItem {
  readonly id: string;
  readonly kind: CfpSubmissionKind;
  readonly status: CfpSubmissionStatus;
  readonly submittedAt: Date | null;
  readonly updatedAt: Date;
  readonly formTitle: string;
  readonly categories: readonly { readonly id: string; readonly label: string }[];
  readonly applicants: readonly {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  }[];
  readonly assignees: readonly {
    readonly id: string;
    readonly displayName: string;
  }[];
  readonly answers: Readonly<Record<string, string>>;
  readonly averageScore: number | null;
  readonly completedReviews: number;
  readonly totalReviews: number;
}

export interface CfpSubmissionListResult {
  readonly items: readonly CfpSubmissionListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly metrics: Readonly<Record<CfpSubmissionStatus, number>>;
}

export interface CfpSubmissionFilterOptions {
  readonly categories: readonly { readonly id: string; readonly label: string }[];
  readonly assignees: readonly { readonly id: string; readonly displayName: string }[];
  readonly customColumns: readonly { readonly id: string; readonly label: string; readonly type: string }[];
}

const formVersionInclude = {
  form: true,
  steps: {
    orderBy: { sortOrder: "asc" },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  },
} as const satisfies Prisma.CfpFormVersionInclude;

const submissionInclude = {
  revisions: {
    orderBy: { versionNumber: "asc" },
    include: { answers: { orderBy: { sortOrder: "asc" } } },
  },
  categories: {
    orderBy: { sortOrder: "asc" },
    include: { category: true },
  },
  transitions: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.CfpSubmissionInclude;

const submissionDetailInclude = {
  event: { select: { id: true, name: true, slug: true, timezone: true } },
  revisions: {
    orderBy: { versionNumber: "desc" },
    take: 1,
    include: { answers: { orderBy: { sortOrder: "asc" } } },
  },
  categories: {
    orderBy: { sortOrder: "asc" },
    include: { category: { select: { id: true, label: true } } },
  },
  participants: {
    orderBy: { sortOrder: "asc" },
    include: {
      speaker: {
        select: {
          id: true,
          profileVersions: { orderBy: { versionNumber: "desc" }, take: 1 },
        },
      },
    },
  },
} as const satisfies Prisma.CfpSubmissionInclude;

const submissionListInclude = {
  formVersion: { select: { title: true } },
  categories: {
    orderBy: { sortOrder: "asc" },
    include: { category: { select: { id: true, label: true } } },
  },
  participants: {
    orderBy: { sortOrder: "asc" },
    include: {
      speaker: {
        select: {
          id: true,
          profileVersions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { email: true, givenName: true, familyName: true, preferredName: true },
          },
        },
      },
    },
  },
  evaluationAssignments: {
    where: { revokedAt: null },
    orderBy: { assignedAt: "asc" },
    include: {
      reviewer: { select: { id: true, displayName: true } },
      evaluation: { select: { status: true, results: { select: { score: true } } } },
    },
  },
  revisions: {
    orderBy: { versionNumber: "desc" },
    take: 1,
    select: { answers: { orderBy: { sortOrder: "asc" }, select: { questionId: true, value: true } } },
  },
} as const satisfies Prisma.CfpSubmissionInclude;

type StoredFormVersion = Prisma.CfpFormVersionGetPayload<{ include: typeof formVersionInclude }>;
type StoredSubmission = Prisma.CfpSubmissionGetPayload<{ include: typeof submissionInclude }>;
type StoredSubmissionDetail = Prisma.CfpSubmissionGetPayload<{ include: typeof submissionDetailInclude }>;
type StoredSubmissionListItem = Prisma.CfpSubmissionGetPayload<{ include: typeof submissionListInclude }>;

const submissionStatuses = Object.values(CfpSubmissionStatus);

function emptyStatusMetrics(): Record<CfpSubmissionStatus, number> {
  return Object.fromEntries(submissionStatuses.map((status) => [status, 0])) as Record<CfpSubmissionStatus, number>;
}

function listItemFromStored(submission: StoredSubmissionListItem): CfpSubmissionListItem {
  const scores = submission.evaluationAssignments.flatMap(({ evaluation }) =>
    evaluation?.status === "FINAL"
      ? evaluation.results.filter(({ score }) => score !== null).map(({ score }) => Number(score))
      : [],
  );
  return {
    id: submission.id,
    kind: submission.kind,
    status: submission.status,
    submittedAt: submission.submittedAt,
    updatedAt: submission.updatedAt,
    formTitle: submission.formVersion.title,
    categories: submission.categories.map(({ category }) => category),
    applicants: submission.participants.map(({ speaker }) => {
      const profile = speaker.profileVersions[0];
      if (!profile) throw new Error(`Speaker ${speaker.id} has no profile version.`);
      return {
        id: speaker.id,
        name: profile.preferredName ?? `${profile.givenName} ${profile.familyName}`,
        email: profile.email,
      };
    }),
    assignees: Array.from(
      new Map(
        submission.evaluationAssignments.map(({ reviewer }) => [
          reviewer.id,
          { id: reviewer.id, displayName: reviewer.displayName },
        ]),
      ).values(),
    ),
    answers: Object.fromEntries(
      (submission.revisions[0]?.answers ?? []).map(({ questionId, value }) => [questionId, displayAnswer(value)]),
    ),
    averageScore: scores.length > 0 ? scores.reduce((total, score) => total + score, 0) / scores.length : null,
    completedReviews: submission.evaluationAssignments.filter(({ evaluation }) => evaluation?.status === "FINAL")
      .length,
    totalReviews: submission.evaluationAssignments.length,
  };
}

function displayAnswer(value: Prisma.JsonValue): string {
  if (value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayAnswer).filter(Boolean).join(", ");
  return JSON.stringify(value);
}

const adminTransitions: Readonly<Record<CfpSubmissionStatus, readonly CfpSubmissionStatus[]>> = {
  [CfpSubmissionStatus.DRAFT]: [],
  [CfpSubmissionStatus.SUBMITTED]: [CfpSubmissionStatus.UNDER_REVIEW],
  [CfpSubmissionStatus.UNDER_REVIEW]: [
    CfpSubmissionStatus.WAITLISTED,
    CfpSubmissionStatus.ACCEPTED,
    CfpSubmissionStatus.REJECTED,
  ],
  [CfpSubmissionStatus.WAITLISTED]: [CfpSubmissionStatus.ACCEPTED, CfpSubmissionStatus.REJECTED],
  [CfpSubmissionStatus.ACCEPTED]: [],
  [CfpSubmissionStatus.REJECTED]: [],
  [CfpSubmissionStatus.CONFIRMED]: [],
};

const decidedStatuses: readonly CfpSubmissionStatus[] = [
  CfpSubmissionStatus.WAITLISTED,
  CfpSubmissionStatus.ACCEPTED,
  CfpSubmissionStatus.REJECTED,
];

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeKey(value: string): string {
  const key = requiredText(value, "key").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    invalid("key must contain lowercase letters, numbers, and single hyphens.");
  }
  return key;
}

function inputJson(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  if (value === undefined) invalid("answer values cannot be undefined.");
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError("conflict", "The event-scoped category or submission revision already exists.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned CFP record was not found.");
    }
  }
  throw error;
}

function definitionFromStored(version: StoredFormVersion): CfpFormDefinition {
  const result = parseCfpDefinition(cfpDefinitionInputFromStored(version));
  if (!result.ok) invalid("The stored CFP form definition is invalid.");
  return result.definition;
}

function definitionFromSnapshot(snapshot: Prisma.JsonValue): CfpFormDefinition {
  const result = parseCfpDefinition(snapshot);
  if (!result.ok) invalid("The stored submission definition snapshot is invalid.");
  return result.definition;
}

function answerData(answers: readonly CfpSubmissionAnswerInput[], definition: CfpFormDefinition) {
  const questionIds = new Set(definition.sections.flatMap((section) => section.questions.map(({ id }) => id)));
  const seen = new Set<string>();
  return answers.map((answer, sortOrder) => {
    const questionId = requiredText(answer.questionId, "questionId");
    if (!questionIds.has(questionId)) invalid(`questionId "${questionId}" is not present in the form definition.`);
    if (seen.has(questionId)) invalid(`questionId "${questionId}" is answered more than once.`);
    seen.add(questionId);
    return { questionId, sortOrder, value: inputJson(answer.value) };
  });
}

function participantData(
  participants: readonly CfpSubmissionParticipantInput[] | undefined,
  definition: CfpFormDefinition,
): readonly ReturnType<typeof validateSpeakerProfileInput>[] {
  if (participants === undefined) return [];
  const minimum = definition.minimumSpeakerCount;
  const maximum = definition.maximumSpeakerCount;
  if (minimum === undefined || maximum === undefined) {
    if (participants.length > 0) invalid("The published form does not accept speaker fields.");
    return [];
  }
  if (participants.length < minimum || participants.length > maximum) {
    invalid(`participants must contain between ${minimum} and ${maximum} speakers.`);
  }

  const requiredFields = new Set(definition.requiredSpeakerFields ?? []);
  const allowedFields = new Set(["email", "givenName", "familyName"]);
  if (requiredFields.has("contact")) allowedFields.add("phone");
  if (requiredFields.has("biography")) allowedFields.add("biography");
  if (requiredFields.has("consent")) allowedFields.add("consent");

  const now = new Date();
  const profiles = participants.map((participant, index) => {
    const unsupportedField = Object.keys(participant).find((field) => !allowedFields.has(field));
    if (unsupportedField) invalid(`participants.${index}.${unsupportedField} is not present in the published form.`);
    if (requiredFields.has("contact") && !participant.phone?.trim()) {
      invalid(`participants.${index}.phone is required.`);
    }
    if (requiredFields.has("biography") && !participant.biography?.trim()) {
      invalid(`participants.${index}.biography is required.`);
    }
    if (requiredFields.has("consent") && participant.consent !== true) {
      invalid(`participants.${index}.consent is required.`);
    }
    const profile: SpeakerProfileInput = {
      email: participant.email,
      givenName: participant.givenName,
      familyName: participant.familyName,
      ...(requiredFields.has("contact") ? { phone: participant.phone } : {}),
      ...(requiredFields.has("biography") ? { biography: participant.biography } : {}),
      ...(requiredFields.has("consent")
        ? { consentToPublishProfile: true, consentToReceiveEmail: true, consentedAt: now }
        : {}),
    };
    return validateSpeakerProfileInput(profile);
  });
  if (new Set(profiles.map(({ email }) => email)).size !== profiles.length) {
    invalid("participants must contain unique email addresses.");
  }
  return profiles;
}

async function requireCategories(
  transaction: Prisma.TransactionClient,
  eventId: string,
  categoryIds: readonly string[],
): Promise<void> {
  if (new Set(categoryIds).size !== categoryIds.length) invalid("categoryIds must not contain duplicates.");
  const count = await transaction.cfpCategory.count({ where: { eventId, id: { in: [...categoryIds] } } });
  if (count !== categoryIds.length) {
    throw new RepositoryError("not-found", "Every category must belong to the submission event.");
  }
}

async function currentSubmissionLimits(
  transaction: Prisma.TransactionClient,
  eventId: string,
  formKey: string,
): Promise<CfpSubmissionLimits | undefined> {
  const policyVersion = await transaction.cfpPolicyVersion.findFirst({
    where: { eventId, policy: { key: formKey } },
    orderBy: { versionNumber: "desc" },
    select: { submissionLimits: true },
  });
  return policyVersion?.submissionLimits as unknown as CfpSubmissionLimits | undefined;
}

/**
 * Locks are taken in sorted participant-email order, before the speaker rows
 * are read or written, so two concurrent finalizations sharing a participant
 * serialize on that participant. Keying on the event-scoped email rather than
 * the speaker id covers the speaker that does not exist yet: otherwise both
 * transactions race to insert the same `eventId_normalizedEmail` row, or to
 * append the same next profile version, and the loser fails with a generic
 * unique-violation conflict before the limit check ever runs.
 */
async function lockSubmissionParticipants(
  transaction: Prisma.TransactionClient,
  eventId: string,
  emails: readonly string[],
): Promise<void> {
  for (const email of [...new Set(emails)].sort()) {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${eventId}:${email}`}))`;
  }
}

async function enforceSubmissionLimitPerSpeaker(
  transaction: Prisma.TransactionClient,
  formId: string,
  speakerIds: readonly string[],
  submissionLimits: CfpSubmissionLimits,
): Promise<void> {
  const uniqueSpeakerIds = [...new Set(speakerIds)].sort();
  if (uniqueSpeakerIds.length === 0) return;
  const counts = await transaction.cfpSubmissionParticipant.groupBy({
    by: ["speakerId"],
    where: {
      speakerId: { in: uniqueSpeakerIds },
      submission: { submittedAt: { not: null }, formVersion: { formId } },
    },
    _count: { _all: true },
  });
  const countBySpeakerId = new Map(counts.map(({ speakerId, _count }) => [speakerId, _count._all]));
  for (const speakerId of uniqueSpeakerIds) {
    const count = countBySpeakerId.get(speakerId) ?? 0;
    if (count >= submissionLimits.maxSubmissionsPerSpeaker) {
      throw new RepositoryError(
        "conflict",
        `A speaker on this submission has already reached the limit of ${submissionLimits.maxSubmissionsPerSpeaker} submissions for this CFP.`,
      );
    }
  }
}

async function createSubmission(
  transaction: Prisma.TransactionClient,
  input: CreateCfpSubmissionDraftInput,
  options: { readonly finalized: boolean; readonly submissionId?: string },
): Promise<string> {
  const formVersion = await transaction.cfpFormVersion.findFirst({
    where: { id: input.formVersionId, form: { eventId: input.eventId } },
    include: formVersionInclude,
  });
  if (!formVersion) throw new RepositoryError("not-found", "The event-owned CFP form version was not found.");
  const definition = definitionFromStored(formVersion);
  const participantProfiles = participantData(input.participants, definition);
  const categoryIds = input.categoryIds ?? [];
  await requireCategories(transaction, input.eventId, categoryIds);
  const submissionLimits = await currentSubmissionLimits(transaction, input.eventId, formVersion.form.key);
  if (submissionLimits && participantProfiles.length > submissionLimits.maxParticipantsPerSubmission) {
    invalid(`Add at most ${submissionLimits.maxParticipantsPerSubmission} speakers to this submission.`);
  }
  if (options.finalized) {
    await lockSubmissionParticipants(
      transaction,
      input.eventId,
      participantProfiles.map(({ email }) => email),
    );
  }
  const speakerIds: string[] = [];
  for (const profile of participantProfiles) {
    const person = await resolvePersonIdentity(transaction, profile);
    const existing = await transaction.speaker.findUnique({
      where: { eventId_normalizedEmail: { eventId: input.eventId, normalizedEmail: profile.email } },
      include: { profileVersions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (existing) {
      const latestVersion = existing.profileVersions[0]?.versionNumber ?? 0;
      await transaction.speaker.update({
        where: { id: existing.id },
        data: { personId: person.id, profileVersions: { create: { versionNumber: latestVersion + 1, ...profile } } },
      });
      speakerIds.push(existing.id);
    } else {
      const speaker = await transaction.speaker.create({
        data: {
          eventId: input.eventId,
          personId: person.id,
          normalizedEmail: profile.email,
          profileVersions: { create: { versionNumber: 1, ...profile } },
        },
        select: { id: true },
      });
      speakerIds.push(speaker.id);
    }
  }

  if (options.finalized && submissionLimits) {
    await enforceSubmissionLimitPerSpeaker(transaction, formVersion.formId, speakerIds, submissionLimits);
  }

  const submittedAt = options.finalized ? new Date() : null;
  const submission = await transaction.cfpSubmission.create({
    data: {
      ...(options.submissionId ? { id: options.submissionId } : {}),
      eventId: input.eventId,
      formVersionId: input.formVersionId,
      kind: input.kind,
      status: options.finalized ? CfpSubmissionStatus.SUBMITTED : CfpSubmissionStatus.DRAFT,
      submittedAt,
      categories: {
        create: categoryIds.map((categoryId, sortOrder) => ({ categoryId, sortOrder })),
      },
      participants: {
        create: speakerIds.map((speakerId, sortOrder) => ({ speakerId, sortOrder })),
      },
      revisions: {
        create: {
          versionNumber: 1,
          kind: options.finalized ? CfpSubmissionRevisionKind.FINAL : CfpSubmissionRevisionKind.DRAFT,
          formVersionId: input.formVersionId,
          definitionSnapshot: inputJson(definition),
          answers: { create: answerData(input.answers, definition) },
        },
      },
      transitions: {
        create: {
          fromStatus: null,
          toStatus: options.finalized ? CfpSubmissionStatus.SUBMITTED : CfpSubmissionStatus.DRAFT,
          actor: CfpSubmissionTransitionActor.SYSTEM,
          ...(submittedAt ? { occurredAt: submittedAt } : {}),
        },
      },
    },
    select: { id: true },
  });
  return submission.id;
}

function matchesFinalizedSubmission(
  submission: {
    readonly eventId: string;
    readonly formVersionId: string;
    readonly kind: CfpSubmissionKind;
    readonly submittedAt: Date | null;
  },
  input: CreateFinalizedCfpSubmissionInput,
): boolean {
  return (
    submission.eventId === input.eventId &&
    submission.formVersionId === input.formVersionId &&
    submission.kind === input.kind &&
    submission.submittedAt !== null
  );
}

function fromStored(submission: StoredSubmission): PersistedCfpSubmission {
  return {
    id: submission.id,
    eventId: submission.eventId,
    formVersionId: submission.formVersionId,
    kind: submission.kind,
    status: submission.status,
    submittedAt: submission.submittedAt,
    reviewStartedAt: submission.reviewStartedAt,
    decidedAt: submission.decidedAt,
    confirmedAt: submission.confirmedAt,
    categoryIds: submission.categories.map(({ categoryId }) => categoryId),
    revisions: submission.revisions.map((revision) => ({
      id: revision.id,
      versionNumber: revision.versionNumber,
      kind: revision.kind,
      formVersionId: revision.formVersionId,
      definition: definitionFromSnapshot(revision.definitionSnapshot),
      answers: revision.answers.map(({ questionId, value }) => ({ questionId, value })),
      createdAt: revision.createdAt,
    })),
    transitions: submission.transitions.map(({ fromStatus, toStatus, actor, actorId, note, occurredAt }) => ({
      fromStatus,
      toStatus,
      actor,
      actorId,
      note,
      occurredAt,
    })),
  };
}

function detailFromStored(submission: StoredSubmissionDetail): CfpSubmissionDetail {
  const storedRevision = submission.revisions[0];
  return {
    id: submission.id,
    kind: submission.kind,
    status: submission.status,
    submittedAt: submission.submittedAt,
    reviewStartedAt: submission.reviewStartedAt,
    decidedAt: submission.decidedAt,
    confirmedAt: submission.confirmedAt,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
    event: submission.event,
    categories: submission.categories.map(({ category }) => category),
    participants: submission.participants.map(({ sortOrder, speaker }) => {
      const profile = speaker.profileVersions[0];
      if (!profile) throw new Error(`Speaker ${speaker.id} has no profile version.`);
      return {
        sortOrder,
        speaker: {
          id: speaker.id,
          email: profile.email,
          givenName: profile.givenName,
          familyName: profile.familyName,
          preferredName: profile.preferredName,
          pronouns: profile.pronouns,
          organization: profile.organization,
          jobTitle: profile.jobTitle,
        },
      };
    }),
    revision: storedRevision
      ? {
          id: storedRevision.id,
          versionNumber: storedRevision.versionNumber,
          kind: storedRevision.kind,
          formVersionId: storedRevision.formVersionId,
          definition: definitionFromSnapshot(storedRevision.definitionSnapshot),
          answers: storedRevision.answers.map(({ questionId, value }) => ({ questionId, value })),
          createdAt: storedRevision.createdAt,
        }
      : null,
  };
}

export class CfpCategoryRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async create(input: CreateCfpCategoryInput): Promise<CfpCategory> {
    try {
      const event = await this.client.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
      if (!event) throw new RepositoryError("not-found", "The event was not found.");
      return await this.client.cfpCategory.create({
        data: {
          eventId: input.eventId,
          key: normalizeKey(input.key),
          label: requiredText(input.label, "label"),
          description: optionalText(input.description),
        },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async list(eventId: string): Promise<CfpCategory[]> {
    return this.client.cfpCategory.findMany({ where: { eventId }, orderBy: [{ label: "asc" }, { key: "asc" }] });
  }
}

export class CfpSubmissionRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async createDraft(input: CreateCfpSubmissionDraftInput): Promise<PersistedCfpSubmission> {
    try {
      const submissionId = await this.client.$transaction((transaction) =>
        createSubmission(transaction, input, { finalized: false }),
      );
      return await this.require(input.eventId, submissionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async createFinalized(input: CreateFinalizedCfpSubmissionInput): Promise<PersistedCfpSubmission> {
    if (!isUuid(input.idempotencyKey)) invalid("idempotencyKey must be a UUID.");
    try {
      const submissionId = await this.client.$transaction(async (transaction) => {
        const existing = await transaction.cfpSubmission.findUnique({
          where: { id: input.idempotencyKey },
          select: { eventId: true, formVersionId: true, kind: true, submittedAt: true },
        });
        if (existing) {
          if (!matchesFinalizedSubmission(existing, input)) {
            invalid("The idempotency key belongs to a different submission.");
          }
          return input.idempotencyKey;
        }
        return createSubmission(transaction, input, {
          finalized: true,
          submissionId: input.idempotencyKey,
        });
      });
      return await this.require(input.eventId, submissionId);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002") {
        const replay = await this.client.cfpSubmission.findUnique({
          where: { id: input.idempotencyKey },
          select: { eventId: true, formVersionId: true, kind: true, submittedAt: true },
        });
        if (replay && matchesFinalizedSubmission(replay, input)) {
          return this.require(input.eventId, input.idempotencyKey);
        }
      }
      return mapDatabaseError(error);
    }
  }

  async saveDraft(
    eventId: string,
    submissionId: string,
    input: SaveCfpSubmissionDraftInput,
  ): Promise<PersistedCfpSubmission> {
    try {
      await this.client.$transaction(async (transaction) => {
        const submission = await transaction.cfpSubmission.findFirst({
          where: { eventId, id: submissionId },
          include: {
            revisions: { orderBy: { versionNumber: "desc" }, take: 1 },
            formVersion: { include: formVersionInclude },
          },
        });
        if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
        if (submission.status !== CfpSubmissionStatus.DRAFT) invalid("Only draft submissions can be edited.");
        const definition = definitionFromStored(submission.formVersion);
        if (input.categoryIds !== undefined) {
          await requireCategories(transaction, eventId, input.categoryIds);
          await transaction.cfpSubmissionCategory.deleteMany({ where: { submissionId } });
          await transaction.cfpSubmissionCategory.createMany({
            data: input.categoryIds.map((categoryId, sortOrder) => ({ eventId, submissionId, categoryId, sortOrder })),
          });
        }
        await transaction.cfpSubmissionRevision.create({
          data: {
            submissionId,
            versionNumber: (submission.revisions[0]?.versionNumber ?? 0) + 1,
            kind: CfpSubmissionRevisionKind.DRAFT,
            formVersionId: submission.formVersionId,
            definitionSnapshot: inputJson(definition),
            answers: { create: answerData(input.answers, definition) },
          },
        });
      });
      return await this.require(eventId, submissionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async finalize(eventId: string, submissionId: string): Promise<PersistedCfpSubmission> {
    try {
      await this.client.$transaction(async (transaction) => {
        const submission = await transaction.cfpSubmission.findFirst({
          where: { eventId, id: submissionId },
          include: {
            revisions: {
              where: { kind: CfpSubmissionRevisionKind.DRAFT },
              orderBy: { versionNumber: "desc" },
              take: 1,
              include: { answers: { orderBy: { sortOrder: "asc" } } },
            },
          },
        });
        if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
        if (submission.status !== CfpSubmissionStatus.DRAFT) invalid("Only a draft submission can be finalized.");
        const draft = submission.revisions[0];
        if (!draft) invalid("A submission must have a draft revision before it can be finalized.");
        const now = new Date();
        const updated = await transaction.cfpSubmission.updateMany({
          where: { id: submissionId, eventId, status: CfpSubmissionStatus.DRAFT },
          data: { status: CfpSubmissionStatus.SUBMITTED, submittedAt: now },
        });
        if (updated.count !== 1) invalid("Only a draft submission can be finalized.");
        await transaction.cfpSubmissionRevision.create({
          data: {
            submissionId,
            versionNumber: draft.versionNumber + 1,
            kind: CfpSubmissionRevisionKind.FINAL,
            formVersionId: draft.formVersionId,
            definitionSnapshot: inputJson(draft.definitionSnapshot),
            answers: {
              create: draft.answers.map(({ questionId, sortOrder, value }) => ({
                questionId,
                sortOrder,
                value: inputJson(value),
              })),
            },
          },
        });
        await transaction.cfpSubmissionTransition.create({
          data: {
            submissionId,
            fromStatus: CfpSubmissionStatus.DRAFT,
            toStatus: CfpSubmissionStatus.SUBMITTED,
            actor: CfpSubmissionTransitionActor.SYSTEM,
            occurredAt: now,
          },
        });
      });
      return await this.require(eventId, submissionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async transition(
    eventId: string,
    submissionId: string,
    toStatus: CfpSubmissionStatus,
    input: { readonly actorId?: string | null; readonly note?: string | null } = {},
  ): Promise<PersistedCfpSubmission> {
    try {
      await this.client.$transaction(async (transaction) => {
        const submission = await transaction.cfpSubmission.findFirst({
          where: { eventId, id: submissionId },
          select: { status: true },
        });
        if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
        if (!adminTransitions[submission.status].includes(toStatus)) {
          invalid(`The transition from ${submission.status} to ${toStatus} is not allowed.`);
        }
        const now = new Date();
        const updated = await transaction.cfpSubmission.updateMany({
          where: { eventId, id: submissionId, status: submission.status },
          data: {
            status: toStatus,
            ...(toStatus === CfpSubmissionStatus.UNDER_REVIEW ? { reviewStartedAt: now } : {}),
            ...(decidedStatuses.includes(toStatus) ? { decidedAt: now } : {}),
          },
        });
        if (updated.count !== 1) invalid("The submission status changed while the transition was being applied.");
        await transaction.cfpSubmissionTransition.create({
          data: {
            submissionId,
            fromStatus: submission.status,
            toStatus,
            actor: CfpSubmissionTransitionActor.ADMIN,
            actorId: optionalText(input.actorId),
            note: optionalText(input.note),
            occurredAt: now,
          },
        });
      });
      return await this.require(eventId, submissionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async confirm(eventId: string, submissionId: string, actorId?: string | null): Promise<PersistedCfpSubmission> {
    try {
      await this.client.$transaction(async (transaction) => {
        const submission = await transaction.cfpSubmission.findFirst({
          where: { eventId, id: submissionId },
          select: { status: true },
        });
        if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
        if (submission.status !== CfpSubmissionStatus.ACCEPTED) {
          invalid("Only an accepted submission can be confirmed by a speaker.");
        }
        const now = new Date();
        const updated = await transaction.cfpSubmission.updateMany({
          where: { eventId, id: submissionId, status: CfpSubmissionStatus.ACCEPTED },
          data: { status: CfpSubmissionStatus.CONFIRMED, confirmedAt: now },
        });
        if (updated.count !== 1) invalid("The submission status changed while confirmation was being applied.");
        await transaction.cfpSubmissionTransition.create({
          data: {
            submissionId,
            fromStatus: CfpSubmissionStatus.ACCEPTED,
            toStatus: CfpSubmissionStatus.CONFIRMED,
            actor: CfpSubmissionTransitionActor.SPEAKER_CONFIRMATION,
            actorId: optionalText(actorId),
            occurredAt: now,
          },
        });
      });
      return await this.require(eventId, submissionId);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async get(eventId: string, submissionId: string): Promise<PersistedCfpSubmission | null> {
    const submission = await this.client.cfpSubmission.findFirst({
      where: { eventId, id: submissionId },
      include: submissionInclude,
    });
    return submission ? fromStored(submission) : null;
  }

  async getDetailByEventSlug(eventSlug: string, submissionId: string): Promise<CfpSubmissionDetail | null> {
    const submission = await this.client.cfpSubmission.findFirst({
      where: { id: submissionId, event: { slug: eventSlug } },
      include: submissionDetailInclude,
    });
    return submission ? detailFromStored(submission) : null;
  }

  async getFilterOptions(eventId: string): Promise<CfpSubmissionFilterOptions> {
    const [categories, assignees, questions] = await Promise.all([
      this.client.cfpCategory.findMany({
        where: { eventId },
        orderBy: [{ label: "asc" }, { key: "asc" }],
        select: { id: true, label: true },
      }),
      this.client.evaluationReviewer.findMany({
        where: { eventId },
        orderBy: [{ displayName: "asc" }, { email: "asc" }],
        select: { id: true, displayName: true },
      }),
      this.client.cfpFormQuestion.findMany({
        where: { step: { version: { form: { eventId } } } },
        orderBy: [{ step: { sortOrder: "asc" } }, { sortOrder: "asc" }],
        select: { key: true, label: true, type: true },
      }),
    ]);
    return {
      categories,
      assignees,
      customColumns: Array.from(
        new Map(questions.map((question) => [question.key, { id: question.key, ...question }])).values(),
      ),
    };
  }

  async listForEvent(eventId: string, query: CfpSubmissionListQuery = {}): Promise<CfpSubmissionListResult> {
    const search = query.search?.trim() ?? "";
    const searchRelations: Prisma.CfpSubmissionWhereInput[] =
      search === ""
        ? []
        : [
            { formVersion: { title: { contains: search, mode: "insensitive" } } },
            { categories: { some: { category: { label: { contains: search, mode: "insensitive" } } } } },
            {
              participants: {
                some: {
                  speaker: {
                    profileVersions: {
                      some: {
                        OR: [
                          { email: { contains: search, mode: "insensitive" } },
                          { givenName: { contains: search, mode: "insensitive" } },
                          { familyName: { contains: search, mode: "insensitive" } },
                          { preferredName: { contains: search, mode: "insensitive" } },
                        ],
                      },
                    },
                  },
                },
              },
            },
            {
              evaluationAssignments: {
                some: { reviewer: { displayName: { contains: search, mode: "insensitive" } } },
              },
            },
            ...(isUuid(search) ? [{ id: search }] : []),
          ];
    const where = {
      eventId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
      ...(query.assigneeId
        ? { evaluationAssignments: { some: { reviewerId: query.assigneeId, revokedAt: null } } }
        : {}),
      ...(searchRelations.length > 0 ? { OR: searchRelations } : {}),
    } satisfies Prisma.CfpSubmissionWhereInput;
    const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 20)));
    const requestedPage = Math.max(1, Math.trunc(query.page ?? 1));
    const [total, groupedStatuses] = await Promise.all([
      this.client.cfpSubmission.count({ where }),
      this.client.cfpSubmission.groupBy({ by: ["status"], where: { eventId }, _count: { _all: true } }),
    ]);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const storedItems = await this.client.cfpSubmission.findMany({
      where,
      include: submissionListInclude,
      orderBy: submissionOrderBy(query.sortBy, query.sortDirection),
      ...(query.all ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
    });
    const metrics = emptyStatusMetrics();
    for (const group of groupedStatuses) metrics[group.status] = group._count._all;
    return {
      items: storedItems.map(listItemFromStored),
      total,
      page,
      pageSize: query.all ? total : pageSize,
      pageCount: query.all ? 1 : pageCount,
      metrics,
    };
  }

  private async require(eventId: string, submissionId: string): Promise<PersistedCfpSubmission> {
    const submission = await this.get(eventId, submissionId);
    if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
    return submission;
  }
}

function submissionOrderBy(
  sortBy: CfpSubmissionSortKey | undefined,
  direction: "asc" | "desc" | undefined,
): Prisma.CfpSubmissionOrderByWithRelationInput[] {
  const order = direction ?? "desc";
  let primary: Prisma.CfpSubmissionOrderByWithRelationInput = { submittedAt: order };
  if (sortBy === "updatedAt") primary = { updatedAt: order };
  if (sortBy === "status") primary = { status: order };
  if (sortBy === "formTitle") primary = { formVersion: { title: order } };
  return [primary, { createdAt: "desc" }, { id: "asc" }];
}
