"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CustomFieldType,
  type CustomFieldType as CustomFieldTypeValue,
  customFieldFormPrefix,
} from "@/lib/custom-fields";

export interface CustomFieldInputDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string | null;
  readonly type: CustomFieldTypeValue;
  readonly required: boolean;
  readonly characterLimit: number | null;
  readonly options: readonly string[];
}

export interface CustomFieldInputValue {
  readonly definitionId: string;
  readonly value: unknown;
}

function storedValue(values: readonly CustomFieldInputValue[], definitionId: string): unknown {
  return values.find((entry) => entry.definitionId === definitionId)?.value;
}

function Description({ children }: { readonly children: string | null }) {
  return children ? <FieldDescription>{children}</FieldDescription> : null;
}

function inputType(type: CustomFieldTypeValue): "date" | "number" | "text" | "url" {
  if (type === CustomFieldType.NUMBER) return "number";
  if (type === CustomFieldType.DATE) return "date";
  if (type === CustomFieldType.URL) return "url";
  return "text";
}

export function CustomFieldInputs({
  definitions,
  values = [],
  disabled = false,
  idPrefix = "",
}: {
  readonly definitions: readonly CustomFieldInputDefinition[];
  readonly values?: readonly CustomFieldInputValue[];
  readonly disabled?: boolean;
  readonly idPrefix?: string;
}) {
  if (definitions.length === 0) return null;
  return (
    <FieldSet>
      <FieldLegend>Custom fields</FieldLegend>
      <FieldGroup>
        {definitions.map((definition) => {
          const name = `${customFieldFormPrefix}${definition.id}`;
          const id = `${idPrefix}custom-field-${definition.id}`;
          const stored = storedValue(values, definition.id);
          if (definition.type === CustomFieldType.LONG_TEXT) {
            return (
              <Field key={definition.id} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor={id}>{definition.label}</FieldLabel>
                <Textarea
                  id={id}
                  name={name}
                  defaultValue={typeof stored === "string" ? stored : ""}
                  maxLength={definition.characterLimit ?? undefined}
                  required={definition.required}
                  disabled={disabled}
                />
                <Description>{definition.description}</Description>
              </Field>
            );
          }
          if (definition.type === CustomFieldType.SINGLE_SELECT) {
            return (
              <Field key={definition.id} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor={id}>{definition.label}</FieldLabel>
                <Select
                  name={name}
                  defaultValue={typeof stored === "string" && stored ? stored : "__empty__"}
                  required={definition.required}
                  disabled={disabled}
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__empty__">No selection</SelectItem>
                      {definition.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Description>{definition.description}</Description>
              </Field>
            );
          }
          if (definition.type === CustomFieldType.MULTI_SELECT) {
            const selected = Array.isArray(stored)
              ? stored.filter((entry): entry is string => typeof entry === "string")
              : [];
            return (
              <FieldSet key={definition.id} disabled={disabled}>
                <FieldLegend variant="label">{definition.label}</FieldLegend>
                <Description>{definition.description}</Description>
                <FieldGroup className="gap-3">
                  {definition.options.map((option) => (
                    <Field key={option} orientation="horizontal" data-disabled={disabled || undefined}>
                      <Checkbox
                        id={`${id}-${option}`}
                        name={name}
                        value={option}
                        defaultChecked={selected.includes(option)}
                        disabled={disabled}
                      />
                      <FieldLabel htmlFor={`${id}-${option}`}>{option}</FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            );
          }
          if (definition.type === CustomFieldType.CHECKBOX) {
            return (
              <Field key={definition.id} orientation="horizontal" data-disabled={disabled || undefined}>
                <Checkbox id={id} name={name} value="true" defaultChecked={stored === true} disabled={disabled} />
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor={id}>{definition.label}</FieldLabel>
                  <Description>{definition.description}</Description>
                </div>
              </Field>
            );
          }
          if (definition.type === CustomFieldType.FILE) {
            const fileName =
              typeof stored === "object" &&
              stored !== null &&
              "fileName" in stored &&
              typeof stored.fileName === "string"
                ? stored.fileName
                : null;
            return (
              <Field key={definition.id} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor={id}>{definition.label}</FieldLabel>
                <Input
                  id={id}
                  name={name}
                  type="file"
                  required={definition.required && !fileName}
                  disabled={disabled}
                />
                <FieldDescription>{fileName ? `Current file: ${fileName}` : definition.description}</FieldDescription>
              </Field>
            );
          }
          return (
            <Field key={definition.id} data-disabled={disabled || undefined}>
              <FieldLabel htmlFor={id}>{definition.label}</FieldLabel>
              <Input
                id={id}
                name={name}
                type={inputType(definition.type)}
                defaultValue={typeof stored === "string" || typeof stored === "number" ? String(stored) : ""}
                maxLength={definition.characterLimit ?? undefined}
                required={definition.required}
                disabled={disabled}
              />
              <Description>{definition.description}</Description>
            </Field>
          );
        })}
      </FieldGroup>
    </FieldSet>
  );
}
