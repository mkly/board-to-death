import type { EventType } from "@/generated/prisma/client";

export interface EventSettingsEvent {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly type: EventType;
  readonly websiteUrl: string | null;
  readonly location: string | null;
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly theme: string | null;
  readonly exhibitorsEnabled: boolean;
  readonly sponsorsEnabled: boolean;
  readonly logoObjectKey: string | null;
  readonly backgroundObjectKey: string | null;
}

export interface EventSettingsRoom {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
}

export interface EventSettingsTrack extends EventSettingsRoom {
  readonly color: string;
}

export interface EventSettingsSnapshot {
  readonly event: EventSettingsEvent;
  readonly rooms: readonly EventSettingsRoom[];
  readonly tracks: readonly EventSettingsTrack[];
}

export interface EventOption {
  readonly id: string;
  readonly name: string;
}

export interface MutationResult {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly snapshot?: EventSettingsSnapshot;
}
