import { CfpAccessPolicy, CfpPolicyStatus, type PrismaClient } from "../../generated/prisma/client.ts";
import { type CfpFormDefinition, parseCfpDefinition } from "../../lib/cfp/index.ts";

export interface CfpPublicAccessEvent {
  readonly id: string;
  readonly name: string;
}

export interface CfpPublicAccessForm {
  readonly versionId: string;
  readonly definition: CfpFormDefinition;
  readonly title: string;
  readonly welcomeTitle: string | null;
  readonly welcomeContent: string | null;
  readonly instructions: string | null;
  readonly termsContent: string | null;
  readonly consentRequired: boolean;
}

export type CfpPublicAccessLookup =
  | { readonly status: "unknown" }
  | { readonly status: "closed"; readonly event: CfpPublicAccessEvent }
  | { readonly status: "not-yet-open"; readonly event: CfpPublicAccessEvent; readonly opensAt: Date }
  | { readonly status: "expired"; readonly event: CfpPublicAccessEvent; readonly closedAt: Date }
  | { readonly status: "restricted"; readonly event: CfpPublicAccessEvent }
  | {
      readonly status: "open";
      readonly publicId: string;
      readonly event: CfpPublicAccessEvent & { readonly timezone: string; readonly theme: string | null };
      readonly form: CfpPublicAccessForm;
      readonly opensAt: Date | null;
      readonly closesAt: Date | null;
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CfpPublicAccessRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async findByPublicId(publicId: string): Promise<CfpPublicAccessLookup> {
    // publicId is a Postgres uuid column, so a non-UUID path segment would
    // make the driver reject the query (22P02) and surface a 500 instead of
    // the not-found page every other unresolvable identifier gets.
    if (!UUID_PATTERN.test(publicId)) {
      return { status: "unknown" };
    }

    const policy = await this.client.cfpPolicy.findUnique({
      where: { publicId },
      select: {
        status: true,
        event: { select: { id: true, name: true, timezone: true, theme: true } },
        publishedFormVersion: {
          select: {
            id: true,
            schemaVersion: true,
            title: true,
            description: true,
            submissionKind: true,
            welcomeTitle: true,
            welcomeContent: true,
            instructions: true,
            termsContent: true,
            consentRequired: true,
            accessPolicy: true,
            minimumSpeakerCount: true,
            maximumSpeakerCount: true,
            requiredSpeakerFields: true,
            customTypes: true,
            categories: true,
            categoryRules: true,
            steps: {
              orderBy: { sortOrder: "asc" },
              select: {
                key: true,
                kind: true,
                title: true,
                description: true,
                questions: {
                  orderBy: { sortOrder: "asc" },
                  select: {
                    key: true,
                    type: true,
                    label: true,
                    description: true,
                    required: true,
                    constraints: true,
                    visibleWhen: true,
                  },
                },
              },
            },
          },
        },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { submissionOpensAt: true, submissionClosesAt: true },
        },
      },
    });

    // A DRAFT policy and a policy that has never been published both look
    // like "unknown" so a guessed publicId cannot distinguish "not found"
    // from "not published yet".
    if (!policy?.publishedFormVersion || policy.status === CfpPolicyStatus.DRAFT) {
      return { status: "unknown" };
    }

    const event: CfpPublicAccessEvent = { id: policy.event.id, name: policy.event.name };

    if (policy.status === CfpPolicyStatus.CLOSED || policy.status === CfpPolicyStatus.ARCHIVED) {
      return { status: "closed", event };
    }

    const policyVersion = policy.versions[0];
    const now = new Date();
    if (policyVersion && now < policyVersion.submissionOpensAt) {
      return { status: "not-yet-open", event, opensAt: policyVersion.submissionOpensAt };
    }
    // Status stays PUBLISHED past the deadline until an admin manually
    // closes it, so "expired" is a time comparison independent of status.
    if (policyVersion && now > policyVersion.submissionClosesAt) {
      return { status: "expired", event, closedAt: policyVersion.submissionClosesAt };
    }

    if (policy.publishedFormVersion.accessPolicy === CfpAccessPolicy.RESTRICTED) {
      return { status: "restricted", event };
    }

    const stored = policy.publishedFormVersion;
    const parsed = parseCfpDefinition({
      version: stored.schemaVersion,
      title: stored.title,
      ...(stored.description === null ? {} : { description: stored.description }),
      ...(stored.submissionKind === null ? {} : { submissionKind: stored.submissionKind }),
      ...(stored.accessPolicy === null ? {} : { accessPolicy: stored.accessPolicy }),
      ...(stored.welcomeTitle === null ? {} : { welcomeTitle: stored.welcomeTitle }),
      ...(stored.welcomeContent === null ? {} : { welcomeContent: stored.welcomeContent }),
      ...(stored.instructions === null ? {} : { instructions: stored.instructions }),
      ...(stored.termsContent === null ? {} : { termsContent: stored.termsContent }),
      ...(stored.consentRequired === null ? {} : { consentRequired: stored.consentRequired }),
      ...(stored.minimumSpeakerCount === null ? {} : { minimumSpeakerCount: stored.minimumSpeakerCount }),
      ...(stored.maximumSpeakerCount === null ? {} : { maximumSpeakerCount: stored.maximumSpeakerCount }),
      ...(stored.requiredSpeakerFields === null ? {} : { requiredSpeakerFields: stored.requiredSpeakerFields }),
      ...((stored.customTypes as unknown[]).length === 0 ? {} : { customQuestionTypes: stored.customTypes }),
      ...(stored.categories === null ? {} : { categories: stored.categories }),
      sections: stored.steps.map((step) => ({
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
      ...(stored.categoryRules === null ? {} : { categoryRouting: stored.categoryRules }),
    });
    if (!parsed.ok) return { status: "unknown" };

    return {
      status: "open",
      publicId,
      event: { ...event, timezone: policy.event.timezone, theme: policy.event.theme },
      form: {
        versionId: stored.id,
        definition: parsed.definition,
        title: stored.title,
        welcomeTitle: stored.welcomeTitle,
        welcomeContent: stored.welcomeContent,
        instructions: stored.instructions,
        termsContent: stored.termsContent,
        consentRequired: stored.consentRequired ?? false,
      },
      opensAt: policyVersion?.submissionOpensAt ?? null,
      closesAt: policyVersion?.submissionClosesAt ?? null,
    };
  }
}
