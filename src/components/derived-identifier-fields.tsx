"use client";

import { useRef, useState } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function identifierFromName(value: string, separator: "-" | "_" = "-"): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "");
}

interface DerivedIdentifierChangesOptions {
  readonly identifier: string;
  readonly identifierIsDerived?: boolean;
  readonly onIdentifierChange: (value: string) => void;
  readonly onSourceChange: (value: string) => void;
  readonly resetKey: string;
  readonly separator?: "-" | "_";
}

export function useDerivedIdentifierChanges({
  identifier,
  identifierIsDerived = false,
  onIdentifierChange,
  onSourceChange,
  resetKey,
  separator = "-",
}: DerivedIdentifierChangesOptions) {
  const derivation = useRef({
    manuallyEdited: identifier !== "" && !identifierIsDerived,
    resetKey,
  });

  if (derivation.current.resetKey !== resetKey) {
    derivation.current = { manuallyEdited: identifier !== "" && !identifierIsDerived, resetKey };
  }

  return {
    changeIdentifier(next: string) {
      derivation.current.manuallyEdited = true;
      onIdentifierChange(next);
    },
    changeSource(next: string) {
      onSourceChange(next);
      if (!derivation.current.manuallyEdited) onIdentifierChange(identifierFromName(next, separator));
    },
  };
}

interface DerivedIdentifierFieldsProps {
  readonly disabled?: boolean;
  readonly identifierDescription?: string;
  readonly identifierError?: string;
  readonly identifierId: string;
  readonly identifierInitialValue?: string;
  readonly identifierInitialValueIsDerived?: boolean;
  readonly identifierLabel: string;
  readonly identifierMaxLength?: number;
  readonly identifierName: string;
  readonly identifierPlaceholder?: string;
  readonly separator?: "-" | "_";
  readonly sourceError?: string;
  readonly sourceId: string;
  readonly sourceInitialValue?: string;
  readonly sourceLabel: string;
  readonly sourceMaxLength?: number;
  readonly sourceName: string;
  readonly sourcePlaceholder?: string;
}

export function DerivedIdentifierFields({
  disabled = false,
  identifierDescription,
  identifierError,
  identifierId,
  identifierInitialValue = "",
  identifierInitialValueIsDerived = false,
  identifierLabel,
  identifierMaxLength,
  identifierName,
  identifierPlaceholder,
  separator = "-",
  sourceError,
  sourceId,
  sourceInitialValue = "",
  sourceLabel,
  sourceMaxLength,
  sourceName,
  sourcePlaceholder,
}: DerivedIdentifierFieldsProps) {
  const [source, setSource] = useState(sourceInitialValue);
  const [identifier, setIdentifier] = useState(identifierInitialValue);
  const changes = useDerivedIdentifierChanges({
    identifier,
    identifierIsDerived: identifierInitialValueIsDerived,
    onIdentifierChange: setIdentifier,
    onSourceChange: setSource,
    resetKey: `${sourceId}:${identifierId}`,
    separator,
  });

  return (
    <>
      <Field data-disabled={disabled} data-invalid={Boolean(sourceError) || undefined}>
        <FieldLabel htmlFor={sourceId}>{sourceLabel}</FieldLabel>
        <Input
          aria-invalid={Boolean(sourceError) || undefined}
          disabled={disabled}
          id={sourceId}
          maxLength={sourceMaxLength}
          name={sourceName}
          onChange={(event) => changes.changeSource(event.target.value)}
          placeholder={sourcePlaceholder}
          required
          value={source}
        />
        <FieldError>{sourceError}</FieldError>
      </Field>
      <Field data-disabled={disabled} data-invalid={Boolean(identifierError) || undefined}>
        <FieldLabel htmlFor={identifierId}>{identifierLabel}</FieldLabel>
        <Input
          aria-invalid={Boolean(identifierError) || undefined}
          disabled={disabled}
          id={identifierId}
          maxLength={identifierMaxLength}
          name={identifierName}
          onChange={(event) => changes.changeIdentifier(event.target.value)}
          placeholder={identifierPlaceholder}
          required
          value={identifier}
        />
        {identifierDescription ? <FieldDescription>{identifierDescription}</FieldDescription> : null}
        <FieldError>{identifierError}</FieldError>
      </Field>
    </>
  );
}
