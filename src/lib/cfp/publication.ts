import type { CfpFormDefinition } from "./types.ts";

export interface CfpPublicationIssue {
  readonly path: string;
  readonly message: string;
}

export function publicCfpHref(publicId: string): string {
  return `/cfp/${encodeURIComponent(publicId)}`;
}

export function validateCfpDefinitionForPublication(definition: CfpFormDefinition): readonly CfpPublicationIssue[] {
  const issues: CfpPublicationIssue[] = [];
  const requireLength = (path: string, value: string | undefined, minimum: number, message: string) => {
    if ((value?.trim().length ?? 0) < minimum) issues.push({ path, message });
  };

  requireLength("title", definition.title, 3, "Enter a form name with at least 3 characters.");
  if (!definition.submissionKind) {
    issues.push({ path: "submissionKind", message: "Choose the kind of submission this form accepts." });
  }
  if (!definition.accessPolicy) {
    issues.push({ path: "accessPolicy", message: "Choose who can access this form." });
  }
  requireLength("welcomeTitle", definition.welcomeTitle, 3, "Enter a welcome heading with at least 3 characters.");
  requireLength(
    "welcomeContent",
    definition.welcomeContent,
    10,
    "Enter at least 10 characters for the welcome message.",
  );
  requireLength("instructions", definition.instructions, 10, "Enter at least 10 characters of instructions.");

  if (definition.minimumSpeakerCount === undefined || definition.maximumSpeakerCount === undefined) {
    issues.push({ path: "speakers", message: "Save the minimum and maximum speaker requirements." });
  }
  if (definition.consentRequired && (definition.termsContent?.trim().length ?? 0) < 10) {
    issues.push({ path: "termsContent", message: "Enter at least 10 characters of terms when consent is required." });
  }

  return issues;
}
