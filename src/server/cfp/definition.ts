/** The single stored-row -> definition-input mapping. Every reader of a stored
 * CFP form version goes through it so the admin editor, the submission
 * repository, and the public form all agree on the definition semantics. */

/** Structural view of the columns the mapping reads, so any Prisma `select` or
 * `include` that covers them can be passed without a repository-specific type. */
export interface StoredCfpFormVersionShape {
  readonly schemaVersion: number;
  readonly title: string;
  readonly description: string | null;
  readonly submissionKind: string | null;
  readonly accessPolicy: string | null;
  readonly welcomeTitle: string | null;
  readonly welcomeContent: string | null;
  readonly instructions: string | null;
  readonly termsContent: string | null;
  readonly consentRequired: boolean | null;
  readonly minimumSpeakerCount: number | null;
  readonly maximumSpeakerCount: number | null;
  readonly requiredSpeakerFields: unknown;
  readonly customTypes: unknown;
  readonly categories: unknown;
  readonly categoryRules: unknown;
  readonly steps: readonly {
    readonly key: string;
    readonly kind: string;
    readonly title: string;
    readonly description: string | null;
    readonly questions: readonly {
      readonly key: string;
      readonly type: string;
      readonly label: string;
      readonly description: string | null;
      readonly required: boolean;
      readonly constraints: unknown;
      readonly visibleWhen: unknown;
    }[];
  }[];
}

/** Build the unparsed definition input for `parseCfpDefinition`. Callers decide
 * how to react to a parse failure. */
export function cfpDefinitionInputFromStored(version: StoredCfpFormVersionShape): unknown {
  return {
    version: version.schemaVersion,
    title: version.title,
    ...(version.description === null ? {} : { description: version.description }),
    ...(version.submissionKind === null ? {} : { submissionKind: version.submissionKind }),
    ...(version.accessPolicy === null ? {} : { accessPolicy: version.accessPolicy }),
    ...(version.welcomeTitle === null ? {} : { welcomeTitle: version.welcomeTitle }),
    ...(version.welcomeContent === null ? {} : { welcomeContent: version.welcomeContent }),
    ...(version.instructions === null ? {} : { instructions: version.instructions }),
    ...(version.termsContent === null ? {} : { termsContent: version.termsContent }),
    ...(version.consentRequired === null ? {} : { consentRequired: version.consentRequired }),
    ...(version.minimumSpeakerCount === null ? {} : { minimumSpeakerCount: version.minimumSpeakerCount }),
    ...(version.maximumSpeakerCount === null ? {} : { maximumSpeakerCount: version.maximumSpeakerCount }),
    ...(version.requiredSpeakerFields === null ? {} : { requiredSpeakerFields: version.requiredSpeakerFields }),
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
  };
}
