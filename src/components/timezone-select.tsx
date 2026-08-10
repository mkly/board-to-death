"use client";

import { useMemo } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

/** The viewer's current IANA time zone, falling back to UTC where unavailable. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function timezoneList(): string[] {
  try {
    const zones = Intl.supportedValuesOf?.("timeZone");
    if (Array.isArray(zones) && zones.length > 0) return zones;
  } catch {
    // Older engines lack Intl.supportedValuesOf; fall through to a minimal list.
  }
  const fallback = browserTimezone();
  return fallback === "UTC" ? ["UTC"] : [fallback, "UTC"];
}

/**
 * Searchable IANA time-zone picker. Replaces the free-text zone input: the
 * browser's zone is the natural default, and typing filters the full list
 * rather than asking people to recall an exact identifier. Emits and accepts
 * plain zone strings and posts through `name` for uncontrolled forms.
 */
export function TimezoneSelect({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  "aria-invalid": ariaInvalid,
}: {
  readonly id: string;
  readonly name?: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  readonly disabled?: boolean;
  readonly "aria-invalid"?: boolean;
}) {
  const zones = useMemo(timezoneList, []);

  return (
    <Combobox
      items={zones}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onChange?.(next ?? "")}
      name={name}
      disabled={disabled}
    >
      <ComboboxInput id={id} className="w-full" placeholder="Search time zone" aria-invalid={ariaInvalid} />
      <ComboboxContent>
        <ComboboxEmpty>No time zone found.</ComboboxEmpty>
        <ComboboxList>
          {(zone: string) => (
            <ComboboxItem key={zone} value={zone}>
              {zone}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
