import {
  type CfpAdministrator,
  type CfpAdminRole,
  type CfpDraftPolicy,
  type CfpPolicy,
  CfpPolicyStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export type CfpRuleCondition = Readonly<Record<string, unknown>>;

export interface CfpConditionalVisibilityRule {
  readonly target: string;
  readonly condition: CfpRuleCondition;
}

export interface CfpCategoryRoutingRule {
  readonly categoryId: string;
  readonly condition: CfpRuleCondition;
}

export interface CfpSubmissionLimits {
  readonly maxSubmissionsPerSpeaker: number;
  readonly maxParticipantsPerSubmission: number;
}

export interface CfpPolicyMessages {
  readonly introduction: string;
  readonly submissionConfirmation: string;
  readonly closed: string;
  readonly thankYou?: string;
  readonly reminder?: {
    readonly enabled: boolean;
    readonly daysBeforeClose: number;
    readonly sendAtMinute: number;
  };
}

export interface CfpPolicyAdminAssignmentInput {
  readonly administratorId: string;
  readonly role: CfpAdminRole;
  readonly notifyOnNewSubmission: boolean;
  readonly notifyOnSubmissionUpdate: boolean;
}

export interface CfpPolicyDefinition {
  readonly submissionOpensAt: Date;
  readonly submissionClosesAt: Date;
  readonly confirmationClosesAt?: Date | null;
  readonly draftPolicy: CfpDraftPolicy;
  readonly submissionLimits: CfpSubmissionLimits;
  readonly messages: CfpPolicyMessages;
  readonly conditionalVisibility: readonly CfpConditionalVisibilityRule[];
  readonly categoryRouting: readonly CfpCategoryRoutingRule[];
  readonly adminAssignments: readonly CfpPolicyAdminAssignmentInput[];
}

export interface CreateCfpPolicyInput {
  readonly eventId: string;
  readonly key: string;
  readonly definition: CfpPolicyDefinition;
}

export interface PersistedCfpPolicyDefinition {
  readonly id: string;
  readonly eventId: string;
  readonly key: string;
  readonly publicId: string;
  readonly status: CfpPolicyStatus;
  readonly publishedFormVersionId: string | null;
  readonly versionNumber: number;
  readonly definition: CfpPolicyDefinition;
}

const versionInclude = {
  policy: true,
  categoryRoutes: { orderBy: { sortOrder: "asc" } },
  adminAssignments: { orderBy: [{ role: "asc" }, { administratorId: "asc" }] },
} as const satisfies Prisma.CfpPolicyVersionInclude;

type StoredVersion = Prisma.CfpPolicyVersionGetPayload<{ include: typeof versionInclude }>;

const allowedTransitions: Readonly<Record<CfpPolicyStatus, readonly CfpPolicyStatus[]>> = {
  [CfpPolicyStatus.DRAFT]: [CfpPolicyStatus.PUBLISHED],
  [CfpPolicyStatus.PUBLISHED]: [CfpPolicyStatus.CLOSED],
  [CfpPolicyStatus.CLOSED]: [CfpPolicyStatus.PUBLISHED, CfpPolicyStatus.ARCHIVED],
  [CfpPolicyStatus.ARCHIVED]: [],
};

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

function normalizeKey(value: string): string {
  const key = requireText(value, "key").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    invalid("key must contain lowercase letters, numbers, and single hyphens.");
  }
  return key;
}

function requireDate(value: Date, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) invalid(`${field} must be a valid date.`);
  return date;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) invalid(`${field} must be a positive integer.`);
  return value;
}

function uniqueValues(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) invalid(`${field} must not contain duplicates.`);
}

function jsonObject(value: CfpRuleCondition, field: string): CfpRuleCondition {
  try {
    const copy = JSON.parse(JSON.stringify(value)) as unknown;
    if (typeof copy !== "object" || copy === null || Array.isArray(copy)) throw new Error("not an object");
    return copy as CfpRuleCondition;
  } catch {
    return invalid(`${field} must be a JSON-serializable object.`);
  }
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function validateDefinition(input: CfpPolicyDefinition): CfpPolicyDefinition {
  const submissionOpensAt = requireDate(input.submissionOpensAt, "submissionOpensAt");
  const submissionClosesAt = requireDate(input.submissionClosesAt, "submissionClosesAt");
  const confirmationClosesAt =
    input.confirmationClosesAt === undefined || input.confirmationClosesAt === null
      ? null
      : requireDate(input.confirmationClosesAt, "confirmationClosesAt");
  if (submissionOpensAt >= submissionClosesAt) {
    invalid("submissionOpensAt must be earlier than submissionClosesAt.");
  }
  if (confirmationClosesAt !== null && confirmationClosesAt < submissionClosesAt) {
    invalid("confirmationClosesAt must not be earlier than submissionClosesAt.");
  }

  const categoryRouting = input.categoryRouting.map((route, index) => ({
    categoryId: requireText(route.categoryId, `categoryRouting.${index}.categoryId`),
    condition: jsonObject(route.condition, `categoryRouting.${index}.condition`),
  }));
  const adminAssignments = input.adminAssignments.map((assignment, index) => ({
    administratorId: requireText(assignment.administratorId, `adminAssignments.${index}.administratorId`),
    role: assignment.role,
    notifyOnNewSubmission: assignment.notifyOnNewSubmission,
    notifyOnSubmissionUpdate: assignment.notifyOnSubmissionUpdate,
  }));
  const conditionalVisibility = input.conditionalVisibility.map((rule, index) => ({
    target: requireText(rule.target, `conditionalVisibility.${index}.target`),
    condition: jsonObject(rule.condition, `conditionalVisibility.${index}.condition`),
  }));

  uniqueValues(
    categoryRouting.map(({ categoryId }) => categoryId),
    "categoryRouting categoryId values",
  );
  uniqueValues(
    adminAssignments.map(({ administratorId }) => administratorId),
    "adminAssignments administratorId values",
  );
  uniqueValues(
    conditionalVisibility.map(({ target }) => target),
    "conditionalVisibility target values",
  );
  if (adminAssignments.length === 0) invalid("adminAssignments must contain at least one administrator.");
  if (!adminAssignments.some(({ role }) => role === "OWNER")) {
    invalid("adminAssignments must contain an OWNER.");
  }

  return {
    submissionOpensAt,
    submissionClosesAt,
    confirmationClosesAt,
    draftPolicy: input.draftPolicy,
    submissionLimits: {
      maxSubmissionsPerSpeaker: positiveInteger(
        input.submissionLimits.maxSubmissionsPerSpeaker,
        "submissionLimits.maxSubmissionsPerSpeaker",
      ),
      maxParticipantsPerSubmission: positiveInteger(
        input.submissionLimits.maxParticipantsPerSubmission,
        "submissionLimits.maxParticipantsPerSubmission",
      ),
    },
    messages: {
      introduction: requireText(input.messages.introduction, "messages.introduction"),
      submissionConfirmation: requireText(input.messages.submissionConfirmation, "messages.submissionConfirmation"),
      closed: requireText(input.messages.closed, "messages.closed"),
      ...(input.messages.thankYou === undefined
        ? {}
        : { thankYou: requireText(input.messages.thankYou, "messages.thankYou") }),
      ...(input.messages.reminder === undefined
        ? {}
        : {
            reminder: {
              enabled: input.messages.reminder.enabled,
              daysBeforeClose: positiveInteger(
                input.messages.reminder.daysBeforeClose,
                "messages.reminder.daysBeforeClose",
              ),
              sendAtMinute:
                Number.isSafeInteger(input.messages.reminder.sendAtMinute) &&
                input.messages.reminder.sendAtMinute >= 0 &&
                input.messages.reminder.sendAtMinute < 1_440
                  ? input.messages.reminder.sendAtMinute
                  : invalid("messages.reminder.sendAtMinute must be a minute from 0 through 1439."),
            },
          }),
    },
    conditionalVisibility,
    categoryRouting,
    adminAssignments,
  };
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") throw new RepositoryError("conflict", "The CFP policy identity already exists.");
    if (code === "P2003") {
      throw new RepositoryError("invalid-input", "A CFP policy reference belongs to a different event.");
    }
    if (code === "P2025") throw new RepositoryError("not-found", "The event-owned CFP policy was not found.");
  }
  throw error;
}

async function validateOwnedReferences(
  transaction: Prisma.TransactionClient,
  eventId: string,
  definition: CfpPolicyDefinition,
): Promise<void> {
  const [categoryCount, administratorCount] = await Promise.all([
    transaction.cfpCategory.count({
      where: { eventId, id: { in: definition.categoryRouting.map(({ categoryId }) => categoryId) } },
    }),
    transaction.cfpAdministrator.count({
      where: { eventId, id: { in: definition.adminAssignments.map(({ administratorId }) => administratorId) } },
    }),
  ]);
  if (categoryCount !== definition.categoryRouting.length) {
    invalid("Every routed category must belong to the policy event.");
  }
  if (administratorCount !== definition.adminAssignments.length) {
    invalid("Every assigned administrator must belong to the policy event.");
  }
}

function versionData(eventId: string, policyId: string, versionNumber: number, definition: CfpPolicyDefinition) {
  return {
    versionNumber,
    submissionOpensAt: definition.submissionOpensAt,
    submissionClosesAt: definition.submissionClosesAt,
    confirmationClosesAt: definition.confirmationClosesAt,
    draftPolicy: definition.draftPolicy,
    submissionLimits: inputJson(definition.submissionLimits),
    messages: inputJson(definition.messages),
    conditionalVisibility: inputJson(definition.conditionalVisibility),
    policy: { connect: { eventId_id: { eventId, id: policyId } } },
    categoryRoutes: {
      create: definition.categoryRouting.map((route, sortOrder) => ({
        condition: inputJson(route.condition),
        sortOrder,
        category: { connect: { eventId_id: { eventId, id: route.categoryId } } },
      })),
    },
    adminAssignments: {
      create: definition.adminAssignments.map(
        ({ administratorId, notifyOnNewSubmission, notifyOnSubmissionUpdate, role }) => ({
          role,
          notifyOnNewSubmission,
          notifyOnSubmissionUpdate,
          administrator: { connect: { eventId_id: { eventId, id: administratorId } } },
        }),
      ),
    },
  } satisfies Prisma.CfpPolicyVersionCreateInput;
}

function fromStored(version: StoredVersion): PersistedCfpPolicyDefinition {
  return {
    id: version.policy.id,
    eventId: version.eventId,
    key: version.policy.key,
    publicId: version.policy.publicId,
    status: version.policy.status,
    publishedFormVersionId: version.policy.publishedFormVersionId,
    versionNumber: version.versionNumber,
    definition: {
      submissionOpensAt: version.submissionOpensAt,
      submissionClosesAt: version.submissionClosesAt,
      confirmationClosesAt: version.confirmationClosesAt,
      draftPolicy: version.draftPolicy,
      submissionLimits: version.submissionLimits as unknown as CfpSubmissionLimits,
      messages: version.messages as unknown as CfpPolicyMessages,
      conditionalVisibility: version.conditionalVisibility as unknown as CfpConditionalVisibilityRule[],
      categoryRouting: version.categoryRoutes.map(({ categoryId, condition }) => ({
        categoryId,
        condition: condition as CfpRuleCondition,
      })),
      adminAssignments: version.adminAssignments.map(
        ({ administratorId, notifyOnNewSubmission, notifyOnSubmissionUpdate, role }) => ({
          administratorId,
          role,
          notifyOnNewSubmission,
          notifyOnSubmissionUpdate,
        }),
      ),
    },
  };
}

export class CfpAdministratorRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async create(input: {
    readonly eventId: string;
    readonly externalId: string;
    readonly displayName: string;
  }): Promise<CfpAdministrator> {
    try {
      return await this.client.cfpAdministrator.create({
        data: {
          eventId: input.eventId,
          externalId: requireText(input.externalId, "externalId"),
          displayName: requireText(input.displayName, "displayName"),
        },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async ensure(input: {
    readonly eventId: string;
    readonly externalId: string;
    readonly displayName: string;
  }): Promise<CfpAdministrator> {
    const externalId = requireText(input.externalId, "externalId").toLowerCase();
    const displayName = requireText(input.displayName, "displayName");
    try {
      return await this.client.cfpAdministrator.upsert({
        where: { eventId_externalId: { eventId: input.eventId, externalId } },
        create: { eventId: input.eventId, externalId, displayName },
        update: { displayName },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async list(eventId: string): Promise<CfpAdministrator[]> {
    return this.client.cfpAdministrator.findMany({
      where: { eventId },
      orderBy: [{ displayName: "asc" }, { externalId: "asc" }],
    });
  }
}

export class CfpPolicyRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async create(input: CreateCfpPolicyInput): Promise<PersistedCfpPolicyDefinition> {
    const definition = validateDefinition(input.definition);
    const key = normalizeKey(input.key);
    try {
      const version = await this.client.$transaction(async (transaction) => {
        const event = await transaction.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
        if (!event) throw new RepositoryError("not-found", "The event was not found.");
        await validateOwnedReferences(transaction, input.eventId, definition);
        const policy = await transaction.cfpPolicy.create({ data: { eventId: input.eventId, key } });
        const created = await transaction.cfpPolicyVersion.create({
          data: versionData(input.eventId, policy.id, 1, definition),
          include: versionInclude,
        });
        await transaction.cfpPolicyTransition.create({
          data: { eventId: input.eventId, policyId: policy.id, fromStatus: null, toStatus: CfpPolicyStatus.DRAFT },
        });
        return created;
      });
      return fromStored(version);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async createVersion(
    eventId: string,
    policyId: string,
    input: CfpPolicyDefinition,
  ): Promise<PersistedCfpPolicyDefinition> {
    const definition = validateDefinition(input);
    try {
      const version = await this.client.$transaction(async (transaction) => {
        const policy = await transaction.cfpPolicy.findFirst({ where: { id: policyId, eventId } });
        if (!policy) throw new RepositoryError("not-found", "The event-owned CFP policy was not found.");
        if (policy.status !== CfpPolicyStatus.DRAFT) invalid("Only draft CFP policies can receive new versions.");
        await validateOwnedReferences(transaction, eventId, definition);
        const latest = await transaction.cfpPolicyVersion.findFirst({
          where: { policyId },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });
        return transaction.cfpPolicyVersion.create({
          data: versionData(eventId, policyId, (latest?.versionNumber ?? 0) + 1, definition),
          include: versionInclude,
        });
      });
      return fromStored(version);
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async get(eventId: string, policyId: string, versionNumber?: number): Promise<PersistedCfpPolicyDefinition | null> {
    const version = await this.client.cfpPolicyVersion.findFirst({
      where: { eventId, policyId, ...(versionNumber === undefined ? {} : { versionNumber }) },
      orderBy: { versionNumber: "desc" },
      include: versionInclude,
    });
    return version ? fromStored(version) : null;
  }

  async getByKey(eventId: string, key: string): Promise<PersistedCfpPolicyDefinition | null> {
    const version = await this.client.cfpPolicyVersion.findFirst({
      where: { eventId, policy: { key: normalizeKey(key) } },
      orderBy: { versionNumber: "desc" },
      include: versionInclude,
    });
    return version ? fromStored(version) : null;
  }

  async updateAdministratorAssignments(
    eventId: string,
    policyId: string,
    actorExternalId: string,
    assignments: readonly CfpPolicyAdminAssignmentInput[],
  ): Promise<PersistedCfpPolicyDefinition> {
    const current = await this.get(eventId, policyId);
    if (!current) throw new RepositoryError("not-found", "The event-owned CFP policy was not found.");

    const actor = await this.client.cfpAdministrator.findUnique({
      where: {
        eventId_externalId: { eventId, externalId: requireText(actorExternalId, "actorExternalId").toLowerCase() },
      },
      select: { id: true },
    });
    const actorAssignment = current.definition.adminAssignments.find(
      ({ administratorId }) => administratorId === actor?.id,
    );
    if (actorAssignment?.role !== "OWNER") {
      throw new RepositoryError("not-found", "Administrator assignment access is required.");
    }

    return this.createVersion(eventId, policyId, { ...current.definition, adminAssignments: assignments });
  }

  async transition(
    eventId: string,
    policyId: string,
    toStatus: CfpPolicyStatus,
    actorAdministratorId: string,
  ): Promise<CfpPolicy> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const [policy, administrator] = await Promise.all([
          transaction.cfpPolicy.findFirst({ where: { id: policyId, eventId } }),
          transaction.cfpAdministrator.findFirst({ where: { id: actorAdministratorId, eventId } }),
        ]);
        if (!policy) throw new RepositoryError("not-found", "The event-owned CFP policy was not found.");
        if (!administrator) invalid("The transition administrator must belong to the policy event.");
        if (!allowedTransitions[policy.status].includes(toStatus)) {
          invalid(`A CFP policy cannot transition from ${policy.status} to ${toStatus}.`);
        }
        const changed = await transaction.cfpPolicy.updateMany({
          where: { id: policyId, eventId, status: policy.status },
          data: { status: toStatus },
        });
        if (changed.count !== 1) throw new RepositoryError("conflict", "The CFP policy changed concurrently.");
        await transaction.cfpPolicyTransition.create({
          data: {
            eventId,
            policyId,
            fromStatus: policy.status,
            toStatus,
            actorAdministratorId,
          },
        });
        return transaction.cfpPolicy.findUniqueOrThrow({ where: { id: policyId } });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async transitionByForm(
    eventId: string,
    formId: string,
    toStatus: CfpPolicyStatus,
    actorExternalId: string,
  ): Promise<CfpPolicy> {
    const context = await this.client.cfpForm.findFirst({
      where: { id: formId, eventId },
      select: {
        key: true,
        event: {
          select: {
            cfpPolicies: {
              where: { key: { not: "" } },
              select: { id: true, key: true },
            },
            cfpAdministrators: {
              where: { externalId: actorExternalId.trim().toLowerCase() },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!context) throw new RepositoryError("not-found", "The event-owned CFP form was not found.");
    const policy = context.event.cfpPolicies.find(({ key }) => key === context.key);
    if (!policy) throw new RepositoryError("not-found", "This CFP form does not have publication settings yet.");
    const administrator = context.event.cfpAdministrators[0];
    if (!administrator) invalid("The signed-in administrator is not assigned to this event's CFP.");
    return this.transition(eventId, policy.id, toStatus, administrator.id);
  }

  async publishByForm(
    eventId: string,
    formId: string,
    expectedVersionNumber: number,
    actorExternalId: string,
  ): Promise<CfpPolicy> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const context = await transaction.cfpForm.findFirst({
          where: { id: formId, eventId },
          select: {
            key: true,
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { id: true, versionNumber: true },
            },
            event: {
              select: {
                cfpPolicies: {
                  where: { key: { not: "" } },
                  select: { id: true, key: true, status: true },
                },
                cfpAdministrators: {
                  where: { externalId: actorExternalId.trim().toLowerCase() },
                  select: { id: true },
                },
              },
            },
          },
        });
        if (!context) throw new RepositoryError("not-found", "The event-owned CFP form was not found.");
        const latestVersion = context.versions[0];
        if (!latestVersion) throw new RepositoryError("not-found", "The CFP form has no saved definition.");
        if (latestVersion.versionNumber !== expectedVersionNumber) {
          throw new RepositoryError("conflict", "The CFP form changed while it was being published. Preview it again.");
        }
        const policy = context.event.cfpPolicies.find(({ key }) => key === context.key);
        if (!policy) throw new RepositoryError("not-found", "This CFP form does not have publication settings yet.");
        if (policy.status !== CfpPolicyStatus.DRAFT) {
          invalid(`A CFP policy cannot transition from ${policy.status} to ${CfpPolicyStatus.PUBLISHED}.`);
        }
        const administrator = context.event.cfpAdministrators[0];
        if (!administrator) invalid("The signed-in administrator is not assigned to this event's CFP.");

        const changed = await transaction.cfpPolicy.updateMany({
          where: { id: policy.id, eventId, status: CfpPolicyStatus.DRAFT },
          data: { status: CfpPolicyStatus.PUBLISHED, publishedFormVersionId: latestVersion.id },
        });
        if (changed.count !== 1) throw new RepositoryError("conflict", "The CFP policy changed concurrently.");
        await transaction.cfpPolicyTransition.create({
          data: {
            eventId,
            policyId: policy.id,
            fromStatus: CfpPolicyStatus.DRAFT,
            toStatus: CfpPolicyStatus.PUBLISHED,
            actorAdministratorId: administrator.id,
          },
        });
        return transaction.cfpPolicy.findUniqueOrThrow({ where: { id: policy.id } });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
