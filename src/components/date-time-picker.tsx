"use client";

import { useState } from "react";

import { addYears, format, parse, subYears } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const VALUE_FORMAT = "yyyy-MM-dd'T'HH:mm";
const DEFAULT_TIME = "09:00";

function parseValue(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = parse(value, VALUE_FORMAT, new Date());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Themed replacement for `<input type="datetime-local">`: the native control's
 * calendar popup ignores the app theme entirely. Produces and accepts the same
 * `yyyy-MM-ddTHH:mm` value strings, so form contracts are unchanged, and posts
 * through a hidden input when `name` is given.
 */
export function DateTimePicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  min,
  disabled,
  "aria-invalid": ariaInvalid,
}: {
  readonly id: string;
  readonly name?: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  readonly min?: string;
  readonly disabled?: boolean;
  readonly "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = value ?? internalValue;
  const selected = parseValue(currentValue);
  const time = currentValue.split("T")[1] ?? "";
  const minDate = parseValue(min);
  const [month, setMonth] = useState(() => selected ?? minDate ?? new Date());
  const today = new Date();

  const setValue = (next: string) => {
    setInternalValue(next);
    onChange?.(next);
  };

  const handleSelect = (date: Date | undefined) => {
    if (!date) return;
    setValue(`${format(date, "yyyy-MM-dd")}T${time || DEFAULT_TIME}`);
  };

  const handleTime = (nextTime: string) => {
    if (!nextTime) return;
    const datePart = selected ? format(selected, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    setValue(`${datePart}T${nextTime}`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setMonth(selected ?? minDate ?? new Date());
        setOpen(nextOpen);
      }}
    >
      {name ? <input type="hidden" name={name} value={currentValue} /> : null}
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          className={cn("w-full justify-start font-normal", !selected && "text-muted-foreground")}
        >
          <CalendarIcon data-icon="inline-start" />
          {selected ? format(selected, "PPp") : "Select date and time"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected ?? undefined}
          month={month}
          onMonthChange={setMonth}
          startMonth={minDate ?? subYears(today, 100)}
          endMonth={addYears(today, 100)}
          disabled={minDate ? { before: minDate } : undefined}
          captionLayout="dropdown"
          onSelect={handleSelect}
        />
        <div className="flex items-center gap-2 border-t p-3">
          <Input
            type="time"
            value={time}
            aria-label="Time"
            className="[&::-webkit-calendar-picker-indicator]:hidden"
            onChange={({ target }) => handleTime(target.value)}
          />
          <Button
            type="button"
            size="sm"
            onClick={(clickEvent) => {
              // Defer unmount so this click finishes inside the still-mounted
              // popover layer; unmounting synchronously leaks the pointer event
              // to a parent Dialog's outside-dismiss and closes it too.
              clickEvent.stopPropagation();
              requestAnimationFrame(() => setOpen(false));
            }}
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
