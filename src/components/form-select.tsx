"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FormSelectOption = {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
};

// Radix Select forbids empty-string item values, but our filter forms submit "" for
// "All …" options. Items with value "" are mapped to this sentinel inside Radix and
// mapped back everywhere the value leaves this component.
const EMPTY_VALUE = "__form-select-empty__";

export type FormSelectGroup = {
  readonly label: string;
  readonly options: readonly FormSelectOption[];
};

type FormSelectProps = {
  readonly options?: readonly FormSelectOption[];
  readonly groups?: readonly FormSelectGroup[];
  readonly id?: string;
  readonly name?: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly size?: "sm" | "default";
  readonly className?: string;
  readonly "aria-label"?: string;
  readonly "aria-invalid"?: boolean;
  readonly "aria-describedby"?: string;
};

function renderItems(options: readonly FormSelectOption[]) {
  return options.map((option) => (
    <SelectItem
      disabled={option.disabled}
      key={option.value === "" ? EMPTY_VALUE : option.value}
      value={option.value === "" ? EMPTY_VALUE : option.value}
    >
      {option.label}
    </SelectItem>
  ));
}

export function FormSelect({
  options,
  groups,
  id,
  name,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  disabled,
  required,
  size,
  className,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: FormSelectProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = isControlled ? value : internalValue;
  const hiddenSelectRef = useRef<HTMLSelectElement | null>(null);

  const notifyHiddenSelect = useCallback((nextValue: string) => {
    const hiddenSelect = hiddenSelectRef.current;
    if (!hiddenSelect) {
      return;
    }

    hiddenSelect.value = nextValue;
    hiddenSelect.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    hiddenSelect.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }, []);

  useEffect(() => {
    notifyHiddenSelect(currentValue);
  }, [currentValue, notifyHiddenSelect]);

  return (
    <>
      {name ? (
        // Native select mirror so plain form posts submit the exact value (including "")
        // and `required` keeps browser constraint validation.
        <select
          ref={hiddenSelectRef}
          aria-hidden
          className="sr-only"
          defaultValue={currentValue}
          name={name}
          required={required}
          tabIndex={-1}
        >
          <option value="" />
          {currentValue ? <option value={currentValue} /> : null}
        </select>
      ) : null}
      <Select
        disabled={disabled}
        onValueChange={(next) => {
          const mapped = next === EMPTY_VALUE ? "" : next;
          if (!isControlled) setInternalValue(mapped);
          notifyHiddenSelect(mapped);
          onValueChange?.(mapped);
        }}
        value={currentValue === "" ? EMPTY_VALUE : currentValue}
      >
        <SelectTrigger
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          className={cn("w-full", className)}
          id={id}
          size={size}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper">
          {groups
            ? groups.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {renderItems(group.options)}
                </SelectGroup>
              ))
            : null}
          {options ? <SelectGroup>{renderItems(options)}</SelectGroup> : null}
        </SelectContent>
      </Select>
    </>
  );
}
