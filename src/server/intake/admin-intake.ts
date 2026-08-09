import {
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  CfpSubmissionTransitionActor,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { parseCfpDefinition, validateCfpAnswers } from "../../lib/cfp/index.ts";
import type { CfpFormDefinition } from "../../lib/cfp/types.ts";
import { cfpDefinitionInputFromStored } from "../cfp/definition.ts";
import { RepositoryError } from "../events/repositories.ts";
import { ProgramSessionRepository } from "../sessions/repositories.ts";
import { createHash, randomUUID } from "node:crypto";

export type AdminIntakeSource = "manual" | "csv";
export type AdminIntakeOutcome = "created" | "updated" | "unchanged";

export interface AdminAbstractIntakeInput {
  readonly eventId: string;
  readonly clientIdentifier: string;
  readonly formVersionId: string;
  readonly status: CfpSubmissionStatus;
  readonly values: Readonly<Record<string, unknown>>;
  readonly categoryIds?: readonly string[];
  readonly speakerIds?: readonly string[];
  readonly actorId: string;
  readonly source: AdminIntakeSource;
  readonly createOnly?: boolean;
  readonly previewOnly?: boolean;
}

export interface AdminGuaranteedSessionIntakeInput {
  readonly eventId: string;
  readonly clientIdentifier: string;
  readonly title: string;
  readonly description?: string | null;
  readonly durationMinutes: number;
  readonly trackId?: string | null;
  readonly speakerIds?: readonly string[];
  readonly actorId: string;
  readonly source: AdminIntakeSource;
  readonly createOnly?: boolean;
  readonly previewOnly?: boolean;
}

export interface AdminIntakeResult {
  readonly id: string;
  readonly outcome: AdminIntakeOutcome;
}

export interface AdminIntakeFormOption {
  readonly id: string;
  readonly formId: string;
  readonly key: string;
  readonly title: string;
  readonly versionNumber: number;
  readonly definition: CfpFormDefinition;
}

const formVersionInclude = {
  form: { select: { id: true, eventId: true, key: true } },
  steps: {
    orderBy: { sortOrder: "asc" },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  },
} as const satisfies Prisma.CfpFormVersionInclude;

type StoredFormVersion = Prisma.CfpFormVersionGetPayload<{ include: typeof formVersionInclude }>;

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requiredText(value: string, field: string, maximum = 200): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  if (normalized.length > maximum) invalid(`${field} must contain at most ${maximum} characters.`);
  return normalized;
}

function clientIdentifier(value: string): string {
  const normalized = requiredText(value, "clientIdentifier", 100).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(normalized)) {
    invalid("clientIdentifier may contain letters, numbers, dots, underscores, colons, and hyphens.");
  }
  return normalized;
}

function optionalText(value: string | null | undefined, maximum = 5_000): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length > maximum) invalid(`description must contain at most ${maximum} characters.`);
  return normalized === "" ? null : normalized;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function payloadHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function definitionFromStored(version: StoredFormVersion): CfpFormDefinition {
  const parsed = parseCfpDefinition(cfpDefinitionInputFromStored(version));
  if (!parsed.ok) invalid("The selected CFP form definition is invalid.");
  return parsed.definition;
}

interface StatusTimestamps {
  readonly submittedAt: Date | null;
  readonly reviewStartedAt: Date | null;
  readonly decidedAt: Date | null;
  readonly confirmedAt: Date | null;
}

/**
 * The milestone timestamps a status implies, keeping the ones an earlier intake
 * already recorded. Re-importing an unchanged status must not restamp when the
 * abstract was submitted or decided, or the audit trail reports today's import
 * as the day the decision happened.
 */
function statusTimestamps(status: CfpSubmissionStatus, now: Date, previous?: StatusTimestamps): StatusTimestamps {
  const reached = (already: Date | null | undefined, isReached: boolean) => (isReached ? (already ?? now) : null);
  return {
    submittedAt: reached(previous?.submittedAt, status !== CfpSubmissionStatus.DRAFT),
    reviewStartedAt: reached(
      previous?.reviewStartedAt,
      status !== CfpSubmissionStatus.DRAFT && status !== CfpSubmissionStatus.SUBMITTED,
    ),
    decidedAt: reached(
      previous?.decidedAt,
      status === CfpSubmissionStatus.WAITLISTED ||
        status === CfpSubmissionStatus.ACCEPTED ||
        status === CfpSubmissionStatus.REJECTED ||
        status === CfpSubmissionStatus.CONFIRMED,
    ),
    confirmedAt: reached(previous?.confirmedAt, status === CfpSubmissionStatus.CONFIRMED),
  };
}

function intakeAudit(source: AdminIntakeSource, actorId: string, now: Date, creating: boolean) {
  return {
    intakeUpdatedBy: actorId,
    ...(creating ? { intakeCreatedBy: actorId } : {}),
    ...(source === "csv" ? { intakeImportedAt: now } : {}),
  };
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      const meta = "meta" in error && error.meta && typeof error.meta === "object" ? error.meta : null;
      const target = meta && "target" in meta && Array.isArray(meta.target) ? meta.target.join(", ") : "unique fields";
      throw new RepositoryError("conflict", `An intake record already uses the same ${target}.`);
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned intake reference was not found.");
    }
  }
  throw error;
}

async function updateStep<T>(label: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002") {
      throw new RepositoryError("conflict", `The abstract update conflicts while replacing ${label}.`);
    }
    throw error;
  }
}

export class AdminIntakeRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async listForms(eventId: string): Promise<AdminIntakeFormOption[]> {
    const forms = await this.#client.cfpForm.findMany({
      where: { eventId },
      orderBy: { key: "asc" },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, include: formVersionInclude } },
    });
    return forms.flatMap((form) => {
      const version = form.versions[0];
      if (!version) return [];
      const definition = definitionFromStored(version);
      if (definition.submissionKind && definition.submissionKind !== "ABSTRACT") return [];
      return [
        {
          id: version.id,
          formId: form.id,
          key: form.key,
          title: version.title,
          versionNumber: version.versionNumber,
          definition,
        },
      ];
    });
  }

  async upsertAbstract(input: AdminAbstractIntakeInput): Promise<AdminIntakeResult> {
    const identifier = clientIdentifier(input.clientIdentifier);
    const actorId = requiredText(input.actorId, "actorId", 320).toLowerCase();
    try {
      return await this.#client.$transaction(async (transaction) => {
        const [formVersion, existing, conflictingSession] = await Promise.all([
          transaction.cfpFormVersion.findFirst({
            where: { id: input.formVersionId, form: { eventId: input.eventId } },
            include: formVersionInclude,
          }),
          transaction.cfpSubmission.findUnique({
            where: { eventId_intakeClientIdentifier: { eventId: input.eventId, intakeClientIdentifier: identifier } },
            include: { revisions: { orderBy: { versionNumber: "desc" }, take: 1 } },
          }),
          transaction.programSession.findUnique({
            where: { eventId_intakeClientIdentifier: { eventId: input.eventId, intakeClientIdentifier: identifier } },
            select: { id: true },
          }),
        ]);
        if (!formVersion) throw new RepositoryError("not-found", "The event-owned CFP form was not found.");
        if (conflictingSession) throw new RepositoryError("conflict", "This client identifier belongs to a session.");
        if (input.createOnly && existing)
          throw new RepositoryError("conflict", "This client identifier already exists.");

        const definition = definitionFromStored(formVersion);
        if (definition.submissionKind && definition.submissionKind !== "ABSTRACT") {
          invalid("The selected form does not accept abstracts.");
        }
        const validatedAnswers = validateCfpAnswers(definition, input.values);
        if (!validatedAnswers.ok) {
          const first = Object.values(validatedAnswers.errors).flat()[0] ?? "The abstract answers are invalid.";
          invalid(first);
        }

        const speakerIds = [...(input.speakerIds ?? [])];
        const categoryIds = [...(input.categoryIds ?? [])];
        if (new Set(speakerIds).size !== speakerIds.length) invalid("Select each participant once.");
        if (new Set(categoryIds).size !== categoryIds.length) invalid("Select each category once.");
        const [speakers, categories] = await Promise.all([
          transaction.speaker.findMany({
            where: { eventId: input.eventId, id: { in: speakerIds } },
            include: { profileVersions: { orderBy: { versionNumber: "desc" }, take: 1 } },
          }),
          transaction.cfpCategory.findMany({
            where: { eventId: input.eventId, id: { in: categoryIds } },
            select: { id: true },
          }),
        ]);
        if (speakers.length !== speakerIds.length) {
          throw new RepositoryError("not-found", "Every participant must belong to this event.");
        }
        if (categories.length !== categoryIds.length) {
          throw new RepositoryError("not-found", "Every category must belong to this event.");
        }
        const minimum = definition.minimumSpeakerCount;
        const maximum = definition.maximumSpeakerCount;
        if (minimum === undefined || maximum === undefined) {
          if (speakerIds.length > 0) invalid("The selected form does not accept participants.");
        } else if (speakerIds.length < minimum || speakerIds.length > maximum) {
          invalid(`Select between ${minimum} and ${maximum} participants.`);
        }
        const requiredFields = new Set(definition.requiredSpeakerFields ?? []);
        for (const speaker of speakers) {
          const profile = speaker.profileVersions[0];
          if (!profile) invalid("Every participant needs a speaker profile.");
          if (requiredFields.has("contact") && !profile.phone)
            invalid("Every participant needs a contact phone number.");
          if (requiredFields.has("biography") && !profile.biography) invalid("Every participant needs a biography.");
          if (
            requiredFields.has("consent") &&
            (!profile.consentToPublishProfile || !profile.consentToReceiveEmail || !profile.consentedAt)
          ) {
            invalid("Every participant must have recorded consent.");
          }
        }

        const routedCategories = await transaction.cfpCategory.findMany({
          where: { eventId: input.eventId, key: { in: [...validatedAnswers.categoryKeys] } },
          select: { id: true, key: true },
        });
        if (routedCategories.length !== validatedAnswers.categoryKeys.length) {
          invalid("The selected form has invalid category routing.");
        }
        const allCategoryIds = [...new Set([...categoryIds, ...routedCategories.map(({ id }) => id)])];
        const normalizedPayload = {
          formVersionId: input.formVersionId,
          status: input.status,
          answers: validatedAnswers.answers,
          categoryIds: allCategoryIds,
          speakerIds,
        };
        const hash = payloadHash(normalizedPayload);
        if (existing?.intakePayloadHash === hash) return { id: existing.id, outcome: "unchanged" };
        if (input.previewOnly) return { id: existing?.id ?? "", outcome: existing ? "updated" : "created" };

        const now = new Date();
        const timestamps = statusTimestamps(input.status, now, existing ?? undefined);
        const revisionKind =
          input.status === CfpSubmissionStatus.DRAFT
            ? CfpSubmissionRevisionKind.DRAFT
            : CfpSubmissionRevisionKind.FINAL;
        const latestRevision = existing
          ? await transaction.cfpSubmissionRevision.aggregate({
              where: { submissionId: existing.id },
              _max: { versionNumber: true },
            })
          : null;
        const revision = {
          versionNumber: (latestRevision?._max.versionNumber ?? 0) + 1,
          kind: revisionKind,
          formVersionId: input.formVersionId,
          definitionSnapshot: jsonInput(definition),
          answers: {
            create: validatedAnswers.answers.map((answer, sortOrder) => ({
              questionId: answer.questionId,
              sortOrder,
              value: jsonInput(answer.value),
            })),
          },
        } satisfies Prisma.CfpSubmissionRevisionUncheckedCreateWithoutSubmissionInput;

        if (!existing) {
          const created = await transaction.cfpSubmission.create({
            data: {
              eventId: input.eventId,
              formVersionId: input.formVersionId,
              kind: CfpSubmissionKind.ABSTRACT,
              status: input.status,
              ...timestamps,
              intakeClientIdentifier: identifier,
              intakePayloadHash: hash,
              ...intakeAudit(input.source, actorId, now, true),
              categories: { create: allCategoryIds.map((categoryId, sortOrder) => ({ categoryId, sortOrder })) },
              participants: { create: speakerIds.map((speakerId, sortOrder) => ({ speakerId, sortOrder })) },
              revisions: { create: revision },
              transitions: {
                create: {
                  fromStatus: null,
                  toStatus: input.status,
                  actor: CfpSubmissionTransitionActor.ADMIN,
                  actorId,
                  note: `Created through ${input.source} admin intake.`,
                  occurredAt: now,
                },
              },
            },
            select: { id: true },
          });
          return { id: created.id, outcome: "created" };
        }

        await transaction.cfpSubmissionCategory.deleteMany({ where: { submissionId: existing.id } });
        await transaction.cfpSubmissionParticipant.deleteMany({ where: { submissionId: existing.id } });
        await updateStep("the submission", () =>
          transaction.cfpSubmission.update({
            where: { id: existing.id },
            data: {
              formVersionId: input.formVersionId,
              status: input.status,
              ...timestamps,
              intakePayloadHash: hash,
              ...intakeAudit(input.source, actorId, now, false),
            },
          }),
        );
        await transaction.cfpSubmissionRevision.updateMany({
          where: { submissionId: existing.id, kind: CfpSubmissionRevisionKind.FINAL },
          data: { kind: CfpSubmissionRevisionKind.DRAFT },
        });
        const revisionId = randomUUID();
        await updateStep("the revision", () =>
          transaction.cfpSubmissionRevision.create({
            data: {
              id: revisionId,
              submissionId: existing.id,
              versionNumber: revision.versionNumber,
              kind: revision.kind,
              formVersionId: revision.formVersionId,
              definitionSnapshot: revision.definitionSnapshot,
            },
          }),
        );
        if (validatedAnswers.answers.length > 0) {
          await updateStep("the revision answers", () =>
            transaction.cfpSubmissionAnswer.createMany({
              data: validatedAnswers.answers.map((answer, sortOrder) => ({
                revisionId,
                questionId: answer.questionId,
                sortOrder,
                value: jsonInput(answer.value),
              })),
            }),
          );
        }
        if (existing.status !== input.status) {
          await updateStep("the audit transition", () =>
            transaction.cfpSubmissionTransition.create({
              data: {
                submissionId: existing.id,
                fromStatus: existing.status,
                toStatus: input.status,
                actor: CfpSubmissionTransitionActor.ADMIN,
                actorId,
                note: `Updated through ${input.source} admin intake.`,
                occurredAt: now,
              },
            }),
          );
        }
        if (allCategoryIds.length > 0) {
          await updateStep("categories", () =>
            transaction.cfpSubmissionCategory.createMany({
              data: allCategoryIds.map((categoryId, sortOrder) => ({
                eventId: input.eventId,
                submissionId: existing.id,
                categoryId,
                sortOrder,
              })),
            }),
          );
        }
        if (speakerIds.length > 0) {
          await updateStep("participants", () =>
            transaction.cfpSubmissionParticipant.createMany({
              data: speakerIds.map((speakerId, sortOrder) => ({
                eventId: input.eventId,
                submissionId: existing.id,
                speakerId,
                sortOrder,
              })),
            }),
          );
        }
        return { id: existing.id, outcome: "updated" };
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async upsertGuaranteedSession(input: AdminGuaranteedSessionIntakeInput): Promise<AdminIntakeResult> {
    const identifier = clientIdentifier(input.clientIdentifier);
    const actorId = requiredText(input.actorId, "actorId", 320).toLowerCase();
    const title = requiredText(input.title, "title");
    const description = optionalText(input.description);
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1_440) {
      invalid("durationMinutes must be a whole number between 1 and 1,440.");
    }
    const speakerIds = [...(input.speakerIds ?? [])];
    const normalizedPayload = {
      title,
      description,
      durationMinutes: input.durationMinutes,
      trackId: input.trackId ?? null,
      speakerIds,
    };
    const hash = payloadHash(normalizedPayload);
    try {
      const [existing, conflictingAbstract] = await Promise.all([
        this.#client.programSession.findUnique({
          where: { eventId_intakeClientIdentifier: { eventId: input.eventId, intakeClientIdentifier: identifier } },
          select: { id: true, intakePayloadHash: true },
        }),
        this.#client.cfpSubmission.findUnique({
          where: { eventId_intakeClientIdentifier: { eventId: input.eventId, intakeClientIdentifier: identifier } },
          select: { id: true },
        }),
      ]);
      if (conflictingAbstract) throw new RepositoryError("conflict", "This client identifier belongs to an abstract.");
      if (input.createOnly && existing) throw new RepositoryError("conflict", "This client identifier already exists.");
      if (existing?.intakePayloadHash === hash) return { id: existing.id, outcome: "unchanged" };
      if (input.previewOnly) {
        const [event, trackCount, speakerCount] = await Promise.all([
          this.#client.event.count({ where: { id: input.eventId } }),
          normalizedPayload.trackId
            ? this.#client.track.count({ where: { eventId: input.eventId, id: normalizedPayload.trackId } })
            : Promise.resolve(1),
          this.#client.speaker.count({ where: { eventId: input.eventId, id: { in: speakerIds } } }),
        ]);
        if (event !== 1 || trackCount !== 1 || speakerCount !== speakerIds.length) {
          throw new RepositoryError("not-found", "A participant, track, or event does not belong to this event.");
        }
        if (new Set(speakerIds).size !== speakerIds.length) invalid("Select each participant once.");
        return { id: existing?.id ?? "", outcome: existing ? "updated" : "created" };
      }

      const repository = new ProgramSessionRepository(this.#client);
      const session = existing
        ? await repository.update(input.eventId, existing.id, normalizedPayload)
        : await repository.createGuaranteed({ eventId: input.eventId, ...normalizedPayload });
      const now = new Date();
      try {
        await this.#client.programSession.update({
          where: { id: session.id },
          data: {
            intakeClientIdentifier: identifier,
            intakePayloadHash: hash,
            ...intakeAudit(input.source, actorId, now, !existing),
          },
        });
      } catch (error) {
        // The session and its intake identity are written by two statements, so a
        // racing import that claims the identifier first would otherwise strand an
        // untracked session that no retry can ever match. Undo our own create.
        if (!existing) {
          await this.#client.programSession.delete({ where: { id: session.id } }).catch(() => {
            // Report the identity failure, not a cleanup failure layered on top of it.
          });
        }
        throw error;
      }
      return { id: session.id, outcome: existing ? "updated" : "created" };
    } catch (error) {
      return mapDatabaseError(error);
    }
  }
}
