import { renderMarkdownToSafeHtml } from "../content/render-markdown.ts";

export const EMAIL_TEMPLATE_VARIABLES = [
  { key: "event.name", label: "Event name", example: "Board Game Summit" },
  { key: "event.start_date", label: "Event start date", example: "October 14, 2026" },
  { key: "event.location", label: "Event location", example: "Portland, Oregon" },
  { key: "recipient.name", label: "Recipient name", example: "Avery Chen" },
  { key: "recipient.email", label: "Recipient email", example: "avery@example.com" },
  { key: "speaker.name", label: "Speaker name", example: "Avery Chen" },
  { key: "session.title", label: "Session title", example: "Designing Welcoming Game Nights" },
  { key: "onboarding.deadline", label: "Onboarding deadline", example: "September 30, 2026" },
] as const;

export type EmailTemplateVariable = (typeof EMAIL_TEMPLATE_VARIABLES)[number]["key"];

export interface EmailTemplateDefinition {
  readonly key: string;
  readonly name: string;
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  readonly textTemplate?: string | null;
}

export interface ValidEmailTemplateDefinition {
  readonly key: string;
  readonly name: string;
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  readonly textTemplate: string | null;
}

export interface EmailTemplateIssue {
  readonly field: "key" | "name" | "subjectTemplate" | "bodyTemplate" | "textTemplate" | "variables";
  readonly message: string;
}

export type EmailTemplateValidationResult =
  | { readonly ok: true; readonly definition: ValidEmailTemplateDefinition }
  | { readonly ok: false; readonly issues: readonly EmailTemplateIssue[] };

export interface RenderedEmailTemplate {
  readonly subject: string;
  readonly html: string;
  readonly previewMarkdown: string;
  readonly text: string | null;
  readonly variables: readonly EmailTemplateVariable[];
}

export type EmailTemplateRenderResult =
  | { readonly ok: true; readonly rendered: RenderedEmailTemplate }
  | { readonly ok: false; readonly issues: readonly EmailTemplateIssue[] };

const VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const TEMPLATE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RAW_HTML_PATTERN = /<\s*\/?\s*[a-z][^>]*>/i;
const ALLOWED_VARIABLES = new Set<string>(EMAIL_TEMPLATE_VARIABLES.map(({ key }) => key));

function requiredText(value: string, field: EmailTemplateIssue["field"], maximum: number) {
  const normalized = value.trim();
  if (normalized === "") {
    return { value: normalized, issue: { field, message: "This field is required." } satisfies EmailTemplateIssue };
  }
  if (normalized.length > maximum) {
    return {
      value: normalized,
      issue: { field, message: `Use ${maximum.toString()} characters or fewer.` } satisfies EmailTemplateIssue,
    };
  }
  return { value: normalized };
}

function extractVariableNames(template: string): { variables: string[]; malformed: string[] } {
  const variables: string[] = [];
  const malformed: string[] = [];
  const completePlaceholders = template.matchAll(/\{\{([\s\S]*?)\}\}/g);

  for (const match of completePlaceholders) {
    const variable = match[1]?.trim() ?? "";
    if (VARIABLE_KEY_PATTERN.test(variable)) {
      variables.push(variable);
    } else {
      malformed.push(match[0]);
    }
  }

  const bracesOutsidePlaceholders = template.replace(/\{\{[\s\S]*?\}\}/g, "");
  if (bracesOutsidePlaceholders.includes("{{") || bracesOutsidePlaceholders.includes("}}")) {
    malformed.push("unmatched variable braces");
  }

  return { variables, malformed };
}

function inspectVariables(templates: readonly string[]): EmailTemplateIssue[] {
  const malformed = new Set<string>();
  const unknown = new Set<string>();

  for (const template of templates) {
    const inspection = extractVariableNames(template);
    for (const placeholder of inspection.malformed) malformed.add(placeholder);
    for (const variable of inspection.variables) {
      if (!ALLOWED_VARIABLES.has(variable)) unknown.add(variable);
    }
  }

  const issues: EmailTemplateIssue[] = [];
  if (malformed.size > 0) {
    issues.push({
      field: "variables",
      message: `Invalid variable syntax: ${[...malformed].join(", ")}. Use {{variable.name}}.`,
    });
  }
  if (unknown.size > 0) {
    issues.push({ field: "variables", message: `Unknown variables: ${[...unknown].join(", ")}.` });
  }
  return issues;
}

export function validateEmailTemplate(input: EmailTemplateDefinition): EmailTemplateValidationResult {
  const issues: EmailTemplateIssue[] = [];
  const key = input.key.trim().toLowerCase();
  const name = requiredText(input.name, "name", 80);
  const subject = requiredText(input.subjectTemplate, "subjectTemplate", 160);
  const body = requiredText(input.bodyTemplate, "bodyTemplate", 20_000);
  const textTemplate = input.textTemplate?.trim() || null;

  if (!TEMPLATE_KEY_PATTERN.test(key)) {
    issues.push({ field: "key", message: "Use lowercase letters, numbers, and single hyphens." });
  }
  if (name.issue) issues.push(name.issue);
  if (subject.issue) issues.push(subject.issue);
  if (body.issue) issues.push(body.issue);
  if (subject.value.includes("\n") || subject.value.includes("\r")) {
    issues.push({ field: "subjectTemplate", message: "The subject must be a single line." });
  }
  if (RAW_HTML_PATTERN.test(body.value)) {
    issues.push({
      field: "bodyTemplate",
      message: "Raw HTML is not allowed. Use Markdown so preview and delivery share the safe renderer.",
    });
  }
  issues.push(...inspectVariables([subject.value, body.value, textTemplate ?? ""]));

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    definition: {
      key,
      name: name.value,
      subjectTemplate: subject.value,
      bodyTemplate: body.value,
      textTemplate,
    },
  };
}

function usedVariables(definition: ValidEmailTemplateDefinition): EmailTemplateVariable[] {
  const variables = new Set<string>();
  for (const template of [definition.subjectTemplate, definition.bodyTemplate, definition.textTemplate ?? ""]) {
    for (const variable of extractVariableNames(template).variables) variables.add(variable);
  }
  return EMAIL_TEMPLATE_VARIABLES.map(({ key }) => key).filter((key) => variables.has(key));
}

function replaceVariables(
  template: string,
  values: Readonly<Record<string, string>>,
  transform: (value: string) => string,
) {
  return template.replace(/\{\{([\s\S]*?)\}\}/g, (_placeholder, variable: string) =>
    transform(values[variable.trim()] ?? ""),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeMarkdown(value: string): string {
  return escapeHtml(value).replace(/([\\`*_[\]{}()#+.!|>-])/g, "\\$1");
}

export function renderEmailTemplate(
  input: EmailTemplateDefinition,
  values: Readonly<Partial<Record<EmailTemplateVariable, string | null>>>,
): EmailTemplateRenderResult {
  const validation = validateEmailTemplate(input);
  if (!validation.ok) return validation;

  const variables = usedVariables(validation.definition);
  const missing = variables.filter((variable) => values[variable] === undefined || values[variable] === null);
  if (missing.length > 0) {
    return { ok: false, issues: [{ field: "variables", message: `Missing values: ${missing.join(", ")}.` }] };
  }

  const resolved = Object.fromEntries(variables.map((variable) => [variable, values[variable] ?? ""]));
  const tokens = new Map<string, string>();
  const tokenizedBody = validation.definition.bodyTemplate.replace(
    /\{\{([\s\S]*?)\}\}/g,
    (_placeholder, variable: string) => {
      const token = `BTDEMAILVARIABLE${tokens.size.toString()}TOKEN`;
      tokens.set(token, resolved[variable.trim()] ?? "");
      return token;
    },
  );

  let html = renderMarkdownToSafeHtml(tokenizedBody);
  for (const [token, value] of tokens) html = html.replaceAll(token, escapeHtml(value));

  return {
    ok: true,
    rendered: {
      subject: replaceVariables(validation.definition.subjectTemplate, resolved, (value) =>
        value.replace(/[\r\n]+/g, " "),
      ),
      html,
      previewMarkdown: replaceVariables(validation.definition.bodyTemplate, resolved, escapeMarkdown),
      text:
        validation.definition.textTemplate === null
          ? null
          : replaceVariables(validation.definition.textTemplate, resolved, (value) => value),
      variables,
    },
  };
}

export const EMAIL_TEMPLATE_PREVIEW_VALUES = Object.fromEntries(
  EMAIL_TEMPLATE_VARIABLES.map(({ key, example }) => [key, example]),
) as Record<EmailTemplateVariable, string>;
