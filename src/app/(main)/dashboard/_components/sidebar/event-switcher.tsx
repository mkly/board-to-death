"use client";

import { useState } from "react";

import { CalendarDays, LoaderCircle } from "lucide-react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { DashboardEvent } from "../../_lib/dashboard-shell";

interface EventSwitcherProps {
  readonly events: readonly DashboardEvent[];
  readonly activeEvent: DashboardEvent | null;
}

export function EventSwitcher({ events, activeEvent }: EventSwitcherProps) {
  const [isSwitching, setIsSwitching] = useState(false);

  if (events.length === 0) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed p-2 text-muted-foreground text-xs">
        <CalendarDays className="size-4 shrink-0" />
        <span className="truncate">No events available</span>
      </div>
    );
  }

  if (events.length === 1) {
    const onlyEvent = activeEvent ?? events[0];
    return (
      <div className="flex h-8 min-w-0 items-center gap-2 py-2 pl-2.5 text-sm">
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate font-medium">{onlyEvent.name}</span>
      </div>
    );
  }

  return (
    <Select
      value={activeEvent?.id}
      disabled={isSwitching}
      onValueChange={(eventId) => {
        setIsSwitching(true);
        window.location.assign(`/dashboard/switch-event?eventId=${encodeURIComponent(eventId)}`);
      }}
    >
      <SelectTrigger className="w-full" aria-label="Active event">
        {isSwitching ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        {/* Radix SelectValue can't resolve item text on the server; render the name directly so it shows on first paint. */}
        <SelectValue placeholder="Choose an event">
          <span className="truncate">{activeEvent?.name}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          {events.map((event) => (
            <SelectItem key={event.id} value={event.id}>
              {event.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
