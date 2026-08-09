export const portalFormFieldTypes = ["text", "textarea", "email", "checkbox"] as const;

export type PortalFormFieldType = (typeof portalFormFieldTypes)[number];

export interface PortalFormVisibilityCondition {
  readonly fieldId: string;
  readonly equals: string | boolean;
}

export interface PortalFormField {
  readonly id: string;
  readonly label: string;
  readonly type: PortalFormFieldType;
  readonly required: boolean;
  readonly reusableKey: string | null;
  readonly visibleWhen: PortalFormVisibilityCondition | null;
}

export interface PortalFormSection {
  readonly id: string;
  readonly title: string;
  readonly instructions: string | null;
  readonly fields: readonly PortalFormField[];
}

export interface PortalFormDefinition {
  readonly kind: "portal-form";
  readonly sections: readonly PortalFormSection[];
  readonly confirmation: {
    readonly subject: string;
    readonly message: string;
    readonly sendEmail: boolean;
  };
}

export type PortalFormAnswers = Readonly<Record<string, string | boolean>>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parsePortalFormDefinition(value: unknown): PortalFormDefinition | null {
  const source = record(value);
  if (source?.kind !== "portal-form" || !Array.isArray(source.sections)) return null;
  const sections: PortalFormSection[] = [];
  const seenIds = new Set<string>();
  for (const sectionValue of source.sections) {
    const section = record(sectionValue);
    if (
      !section ||
      typeof section.id !== "string" ||
      typeof section.title !== "string" ||
      !Array.isArray(section.fields)
    ) {
      return null;
    }
    const fields: PortalFormField[] = [];
    for (const fieldValue of section.fields) {
      const field = record(fieldValue);
      if (
        !field ||
        typeof field.id !== "string" ||
        seenIds.has(field.id) ||
        typeof field.label !== "string" ||
        typeof field.type !== "string" ||
        !portalFormFieldTypes.some((type) => type === field.type) ||
        typeof field.required !== "boolean"
      ) {
        return null;
      }
      seenIds.add(field.id);
      const visibility = record(field.visibleWhen);
      const sourceField =
        visibility && typeof visibility.fieldId === "string"
          ? (fields.find(({ id }) => id === visibility.fieldId) ??
            sections
              .flatMap(({ fields: previousFields }) => previousFields)
              .find(({ id }) => id === visibility.fieldId))
          : undefined;
      if (
        visibility !== null &&
        (!sourceField ||
          !(typeof visibility.equals === "string" || typeof visibility.equals === "boolean") ||
          (sourceField.type === "checkbox") !== (typeof visibility.equals === "boolean"))
      ) {
        return null;
      }
      fields.push({
        id: field.id,
        label: field.label,
        type: field.type as PortalFormFieldType,
        required: field.required,
        reusableKey: typeof field.reusableKey === "string" && field.reusableKey !== "" ? field.reusableKey : null,
        visibleWhen: visibility
          ? { fieldId: visibility.fieldId as string, equals: visibility.equals as string | boolean }
          : null,
      });
    }
    sections.push({
      id: section.id,
      title: section.title,
      instructions:
        typeof section.instructions === "string" && section.instructions !== "" ? section.instructions : null,
      fields,
    });
  }
  const confirmation = record(source.confirmation);
  return {
    kind: "portal-form",
    sections,
    confirmation: {
      subject: typeof confirmation?.subject === "string" ? confirmation.subject : "Response received",
      message:
        typeof confirmation?.message === "string" ? confirmation.message : "Thank you. Your response was submitted.",
      sendEmail: confirmation?.sendEmail === true,
    },
  };
}

export function visiblePortalFormFieldIds(
  definition: PortalFormDefinition,
  answers: PortalFormAnswers,
): ReadonlySet<string> {
  const visible = new Set<string>();
  for (const field of definition.sections.flatMap(({ fields }) => fields)) {
    const condition = field.visibleWhen;
    if (!condition || (visible.has(condition.fieldId) && answers[condition.fieldId] === condition.equals)) {
      visible.add(field.id);
    }
  }
  return visible;
}

export function parsePortalFormAnswers(value: unknown): PortalFormAnswers {
  const source = record(value);
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string | boolean] => {
      const answer = entry[1];
      return typeof answer === "string" || typeof answer === "boolean";
    }),
  );
}

export function validatePortalFormAnswers(
  definition: PortalFormDefinition,
  answers: PortalFormAnswers,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  const visibleIds = visiblePortalFormFieldIds(definition, answers);
  for (const field of definition.sections.flatMap(({ fields }) => fields)) {
    if (!visibleIds.has(field.id)) continue;
    const answer = answers[field.id];
    if (
      field.required &&
      (answer === undefined || answer === false || (typeof answer === "string" && answer.trim() === ""))
    ) {
      errors[field.id] = `${field.label} is required.`;
      continue;
    }
    if (
      field.type === "email" &&
      typeof answer === "string" &&
      answer.trim() !== "" &&
      !/^\S+@\S+\.\S+$/.test(answer)
    ) {
      errors[field.id] = "Enter a valid email address.";
    }
  }
  return errors;
}

export function answersFromFormData(definition: PortalFormDefinition, formData: FormData): PortalFormAnswers {
  const answers = Object.fromEntries(
    definition.sections.flatMap(({ fields }) =>
      fields.map((field) => [
        field.id,
        field.type === "checkbox" ? formData.get(field.id) === "on" : String(formData.get(field.id) ?? "").trim(),
      ]),
    ),
  );
  const visibleIds = visiblePortalFormFieldIds(definition, answers);
  return Object.fromEntries(Object.entries(answers).filter(([fieldId]) => visibleIds.has(fieldId)));
}
