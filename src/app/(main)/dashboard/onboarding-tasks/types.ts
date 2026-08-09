export type TaskResponseType = "NONE" | "TEXT" | "FILE";

export interface EventOption {
  readonly id: string;
  readonly name: string;
}

export interface TaskDefinitionView {
  readonly id: string;
  readonly key: string;
  readonly archivedAt: string | null;
  readonly versionNumber: number;
  readonly sortOrder: number;
  readonly title: string;
  readonly description: string | null;
  readonly confirmedOnly: boolean;
  readonly sessionKinds: readonly string[];
  readonly defaultDueOffsetDays: number | null;
  readonly responseType: TaskResponseType;
}

export interface OnboardingSnapshot {
  readonly eventId: string;
  readonly definitions: readonly TaskDefinitionView[];
}

export interface MutationResult {
  readonly ok: boolean;
  readonly message: string;
  readonly snapshot?: OnboardingSnapshot;
  readonly fieldErrors?: Readonly<Record<string, readonly string[] | undefined>>;
}
