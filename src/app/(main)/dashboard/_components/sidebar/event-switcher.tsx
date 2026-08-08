"use client";

import { useState } from "react";

import { CalendarDays } from "lucide-react";

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
        <CalendarDays />
        <span className="truncate">No events available</span>
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
        <SelectValue placeholder="Choose an event" />
      </SelectTrigger>
      <SelectContent>
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
