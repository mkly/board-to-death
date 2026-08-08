import { CfpPolicyStatus, type Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import { type CfpFormDefinition, parseCfpDefinition } from "../../lib/cfp/index.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface CreateCfpFormInput {
  readonly eventId: string;
  readonly key: string;
  readonly definition: CfpFormDefinition;
}

export interface PersistedCfpFormDefinition {
  readonly formId: string;
  readonly eventId: string;
  readonly key: string;
  readonly versionNumber: number;
  readonly definition: CfpFormDefinition;
}

export interface CfpFormSummary {
  readonly id: string;
  readonly eventId: string;
  readonly key: string;
  readonly title: string;
  readonly versionNumber: number;
  readonly status: CfpPolicyStatus;
  readonly submissionClosesAt: Date | null;
  readonly responseCount: number;
  readonly assignedAdministrators: readonly string[];
}

const versionInclude = {
  form: true,
  steps: {
    orderBy: { sortOrder: "asc" },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  },
} as const satisfies Prisma.CfpFormVersionInclude;

type StoredVersion = Prisma.CfpFormVersionGetPayload<{ include: typeof versionInclude }>;

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function normalizeKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    invalid("key must contain lowercase letters, numbers, and single hyphens.");
  }
  return key;
}

function validatedDefinition(input: unknown): CfpFormDefinition {
  const result = parseCfpDefinition(input);
  if (!result.ok) {
    const details = result.errors.map(({ path, message }) => `${path}: ${message}`).join("; ");
    invalid(`The CFP form definition is invalid. ${details}`);
  }
  return result.definition;
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function optionalJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : inputJson(value);
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError("conflict", "A CFP form with the same event key or version already exists.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned CFP form was not found.");
    }
  }
  throw error;
}

function versionData(formId: string, versionNumber: number, definition: CfpFormDefinition) {
  return {
    formId,
    versionNumber,
    schemaVersion: definition.version,
    title: definition.title,
    description: definition.description,
    customTypes: inputJson(definition.customQuestionTypes ?? []),
    categories: optionalJson(definition.categories),
    categoryRules: optionalJson(definition.categoryRouting),
    steps: {
      create: definition.sections.map((section, sortOrder) => ({
        key: section.id,
        kind: section.kind,
        title: section.title,
        description: section.description,
        sortOrder,
        questions: {
          create: section.questions.map((question, questionSortOrder) => ({
            key: question.id,
            type: question.type,
            label: question.label,
            description: question.description,
            required: question.required,
            constraints: optionalJson(question.constraints),
            visibleWhen: optionalJson(question.visibleWhen),
            sortOrder: questionSortOrder,
          })),
        },
      })),
    },
  } satisfies Prisma.CfpFormVersionUncheckedCreateInput;
}

function fromStored(version: StoredVersion): PersistedCfpFormDefinition {
  const definition = validatedDefinition({
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

  return {
    formId: version.form.id,
    eventId: version.form.eventId,
    key: version.form.key,
    versionNumber: version.versionNumber,
    definition,
  };
}

export class CfpFormRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async create(input: CreateCfpFormInput): Promise<PersistedCfpFormDefinition> {
    const definition = validatedDefinition(input.definition);
    const key = normalizeKey(input.key);
    try {
      const version = await this.client.$transaction(async (transaction) => {
        const event = await transaction.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
        if (!event) throw new RepositoryError("not-found", "The event was not found.");
        const form = await transaction.cfpForm.create({ data: { eventId: input.eventId, key } });
        return transaction.cfpFormVersion.create({
          data: versionData(form.id, 1, definition),
          include: versionInclude,
        });
      });
      return fromStored(version);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async list(eventId: string): Promise<CfpFormSummary[]> {
    const forms = await this.client.cfpForm.findMany({
      where: { eventId },
      orderBy: [{ updatedAt: "desc" }, { key: "asc" }],
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          include: { _count: { select: { submissions: true } } },
        },
      },
    });
    const policies = await this.client.cfpPolicy.findMany({
      where: { eventId, key: { in: forms.map(({ key }) => key) } },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: {
            adminAssignments: {
              orderBy: [{ role: "asc" }, { administratorId: "asc" }],
              include: { administrator: true },
            },
          },
        },
      },
    });
    const policiesByKey = new Map(policies.map((policy) => [policy.key, policy]));

    return forms.flatMap((form) => {
      const latestVersion = form.versions[0];
      if (!latestVersion) return [];
      const policy = policiesByKey.get(form.key);
      const policyVersion = policy?.versions[0];

      return [
        {
          id: form.id,
          eventId: form.eventId,
          key: form.key,
          title: latestVersion.title,
          versionNumber: latestVersion.versionNumber,
          status: policy?.status ?? CfpPolicyStatus.DRAFT,
          submissionClosesAt: policyVersion?.submissionClosesAt ?? null,
          responseCount: form.versions.reduce((total, version) => total + version._count.submissions, 0),
          assignedAdministrators:
            policyVersion?.adminAssignments.map(({ administrator }) => administrator.displayName) ?? [],
        },
      ];
    });
  }

  async createVersion(eventId: string, formId: string, input: CfpFormDefinition): Promise<PersistedCfpFormDefinition> {
    const definition = validatedDefinition(input);
    try {
      const version = await this.client.$transaction(async (transaction) => {
        const form = await transaction.cfpForm.findFirst({ where: { id: formId, eventId }, select: { id: true } });
        if (!form) throw new RepositoryError("not-found", "The event-owned CFP form was not found.");
        const latest = await transaction.cfpFormVersion.findFirst({
          where: { formId },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });
        return transaction.cfpFormVersion.create({
          data: versionData(formId, (latest?.versionNumber ?? 0) + 1, definition),
          include: versionInclude,
        });
      });
      return fromStored(version);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async get(eventId: string, formId: string, versionNumber?: number): Promise<PersistedCfpFormDefinition | null> {
    const version = await this.client.cfpFormVersion.findFirst({
      where: { formId, form: { eventId }, ...(versionNumber === undefined ? {} : { versionNumber }) },
      orderBy: { versionNumber: "desc" },
      include: versionInclude,
    });
    return version ? fromStored(version) : null;
  }
}
