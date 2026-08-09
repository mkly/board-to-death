import { type CustomFieldDefinition, CustomFieldType } from "@/generated/prisma/client";
import { customFieldFormPrefix } from "@/lib/custom-fields";
import type { CustomFieldInputValue } from "@/server/custom-fields/repositories";
import { RepositoryError } from "@/server/events/repositories";

export interface ParsedCustomFieldValue {
  readonly definition: CustomFieldDefinition;
  readonly value: CustomFieldInputValue;
}

export interface ParsedCustomFieldFile {
  readonly definition: CustomFieldDefinition;
  readonly file: File;
}

export function parseCustomFieldFormData(
  formData: FormData,
  definitions: readonly CustomFieldDefinition[],
): { readonly values: readonly ParsedCustomFieldValue[]; readonly files: readonly ParsedCustomFieldFile[] } {
  const values: ParsedCustomFieldValue[] = [];
  const files: ParsedCustomFieldFile[] = [];
  for (const definition of definitions) {
    const name = `${customFieldFormPrefix}${definition.id}`;
    if (definition.type === CustomFieldType.FILE) {
      const entry = formData.get(name);
      if (entry instanceof File && entry.size > 0) files.push({ definition, file: entry });
      continue;
    }
    if (definition.type === CustomFieldType.CHECKBOX) {
      values.push({ definition, value: formData.getAll(name).includes("true") });
      continue;
    }
    if (definition.type === CustomFieldType.MULTI_SELECT) {
      values.push({
        definition,
        value: formData.getAll(name).filter((entry): entry is string => typeof entry === "string"),
      });
      continue;
    }
    const entry = formData.get(name);
    const stringValue = typeof entry === "string" ? entry.trim() : "";
    if (definition.type === CustomFieldType.NUMBER && stringValue !== "") {
      const numberValue = Number(stringValue);
      if (!Number.isFinite(numberValue))
        throw new RepositoryError("invalid-input", `${definition.label} must be a number.`);
      values.push({ definition, value: numberValue });
      continue;
    }
    values.push({ definition, value: stringValue === "__empty__" ? "" : stringValue });
  }
  return { values, files };
}
