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
import { RepositoryError } from "../events/repositories.ts";

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

export interface CreateCfpSubmissionDraftInput {
  readonly eventId: string;
  readonly formVersionId: string;
  readonly kind: CfpSubmissionKind;
  readonly answers: readonly CfpSubmissionAnswerInput[];
  readonly categoryIds?: readonly string[];
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

type StoredFormVersion = Prisma.CfpFormVersionGetPayload<{ include: typeof formVersionInclude }>;
type StoredSubmission = Prisma.CfpSubmissionGetPayload<{ include: typeof submissionInclude }>;

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
  const result = parseCfpDefinition({
    version: version.schemaVersion,
    title: version.title,
    ...(version.description === null ? {} : { description: version.description }),
    ...((version.customTypes as unknown[]).length === 0 ? {} : { customQuestionTypes: version.customTypes }),
    ...(version.categories === null ? {} : { categories: version.categories }),
    sections: version.steps.map((step) => ({
      id: step.key,
      kind: step.kind,
      title: step.title,
      ...(step.description === null ? {} : { description: step.description }),
      questions: step.questions.map((question) => ({
        id: question.key,
        type: question.type,
        label: question.label,
        ...(question.description === null ? {} : { description: question.description }),
        required: question.required,
        ...(question.constraints === null ? {} : { constraints: question.constraints }),
        ...(question.visibleWhen === null ? {} : { visibleWhen: question.visibleWhen }),
      })),
    })),
    ...(version.categoryRules === null ? {} : { categoryRouting: version.categoryRules }),
  });
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
      const submissionId = await this.client.$transaction(async (transaction) => {
        const formVersion = await transaction.cfpFormVersion.findFirst({
          where: { id: input.formVersionId, form: { eventId: input.eventId } },
          include: formVersionInclude,
        });
        if (!formVersion) throw new RepositoryError("not-found", "The event-owned CFP form version was not found.");
        const definition = definitionFromStored(formVersion);
        const categoryIds = input.categoryIds ?? [];
        await requireCategories(transaction, input.eventId, categoryIds);
        const submission = await transaction.cfpSubmission.create({
          data: {
            eventId: input.eventId,
            formVersionId: input.formVersionId,
            kind: input.kind,
            categories: {
              create: categoryIds.map((categoryId, sortOrder) => ({ categoryId, sortOrder })),
            },
            revisions: {
              create: {
                versionNumber: 1,
                kind: CfpSubmissionRevisionKind.DRAFT,
                formVersionId: input.formVersionId,
                definitionSnapshot: inputJson(definition),
                answers: { create: answerData(input.answers, definition) },
              },
            },
            transitions: {
              create: {
                fromStatus: null,
                toStatus: CfpSubmissionStatus.DRAFT,
                actor: CfpSubmissionTransitionActor.SYSTEM,
              },
            },
          },
          select: { id: true },
        });
        return submission.id;
      });
      return await this.require(input.eventId, submissionId);
    } catch (error) {
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

  private async require(eventId: string, submissionId: string): Promise<PersistedCfpSubmission> {
    const submission = await this.get(eventId, submissionId);
    if (!submission) throw new RepositoryError("not-found", "The event-owned submission was not found.");
    return submission;
  }
}
