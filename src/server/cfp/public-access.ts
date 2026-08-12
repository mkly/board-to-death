import { CfpAccessPolicy, CfpDraftPolicy, CfpPolicyStatus, type PrismaClient } from "../../generated/prisma/client.ts";
import { type CfpFormDefinition, parseCfpDefinition } from "../../lib/cfp/index.ts";
import { cfpDefinitionInputFromStored } from "./definition.ts";
import type { CfpPolicyMessages } from "./policies.ts";

export interface CfpPublicAccessEvent {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface CfpPublicAccessPolicy {
  readonly id: string;
  readonly versionNumber: number;
  readonly messages: CfpPolicyMessages;
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
      readonly policyId: string;
      readonly draftPolicy: CfpDraftPolicy;
      readonly event: CfpPublicAccessEvent & {
        readonly timezone: string;
        readonly theme: string | null;
        readonly startsAt: Date;
        readonly location: string | null;
      };
      readonly form: CfpPublicAccessForm;
      readonly policy: CfpPublicAccessPolicy;
      readonly opensAt: Date | null;
      readonly closesAt: Date | null;
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CfpPublicAccessRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  async findByPublicId(publicIdOrEventSlug: string): Promise<CfpPublicAccessLookup> {
    const isPublicId = UUID_PATTERN.test(publicIdOrEventSlug);
    const policy = await this.client.cfpPolicy.findFirst({
      where: isPublicId
        ? { publicId: publicIdOrEventSlug }
        : {
            event: { slug: publicIdOrEventSlug },
            publishedFormVersionId: { not: null },
            status: CfpPolicyStatus.PUBLISHED,
          },
      // An event can own multiple CFP forms. Its friendly slug resolves to
      // the most recently updated active publication; UUID links remain exact.
      orderBy: isPublicId ? undefined : [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        publicId: true,
        status: true,
        event: {
          select: { id: true, name: true, slug: true, timezone: true, theme: true, startsAt: true, location: true },
        },
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
          select: {
            versionNumber: true,
            submissionOpensAt: true,
            submissionClosesAt: true,
            draftPolicy: true,
            messages: true,
          },
        },
      },
    });

    // A DRAFT policy and a policy that has never been published both look
    // like "unknown" so a guessed publicId cannot distinguish "not found"
    // from "not published yet".
    if (!policy?.publishedFormVersion || policy.status === CfpPolicyStatus.DRAFT) {
      return { status: "unknown" };
    }

    const event: CfpPublicAccessEvent = { id: policy.event.id, name: policy.event.name, slug: policy.event.slug };

    if (policy.status === CfpPolicyStatus.CLOSED || policy.status === CfpPolicyStatus.ARCHIVED) {
      return { status: "closed", event };
    }

    const policyVersion = policy.versions[0];
    if (!policyVersion) return { status: "unknown" };
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
    const parsed = parseCfpDefinition(cfpDefinitionInputFromStored(stored));
    if (!parsed.ok) return { status: "unknown" };

    return {
      status: "open",
      publicId: policy.publicId,
      policyId: policy.id,
      draftPolicy: policyVersion.draftPolicy ?? CfpDraftPolicy.DISABLED,
      event: {
        ...event,
        timezone: policy.event.timezone,
        theme: policy.event.theme,
        startsAt: policy.event.startsAt,
        location: policy.event.location,
      },
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
      policy: {
        id: policy.id,
        versionNumber: policyVersion.versionNumber,
        messages: policyVersion.messages as unknown as CfpPolicyMessages,
      },
      opensAt: policyVersion.submissionOpensAt,
      closesAt: policyVersion.submissionClosesAt,
    };
  }
}
