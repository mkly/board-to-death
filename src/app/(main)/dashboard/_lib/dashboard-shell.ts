export const ACTIVE_EVENT_COOKIE = "gatherpulse_active_event";

export interface DashboardOrganization {
  readonly id: string;
  readonly name: string;
}

export interface DashboardEvent {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export function resolveActiveEvent(
  events: readonly DashboardEvent[],
  selectedEventId: string | undefined,
): DashboardEvent | null {
  return events.find(({ id }) => id === selectedEventId) ?? events[0] ?? null;
}

export function findAuthorizedEvent(events: readonly DashboardEvent[], eventSlug: string): DashboardEvent | null {
  return events.find(({ slug }) => slug === eventSlug) ?? null;
}
