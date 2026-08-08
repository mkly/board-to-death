import { Temporal } from "temporal-polyfill";

export interface AgendaBounds {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timezone: string;
}

export interface AgendaPlacement {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomId?: string | null;
  readonly trackIds?: readonly string[];
  readonly speakerIds?: readonly string[];
}

export type AgendaConflictType = "event-boundary" | "room" | "speaker" | "track";

export interface AgendaConflict {
  readonly type: AgendaConflictType;
  readonly placementIds: readonly [string] | readonly [string, string];
  readonly resourceId: string | null;
  readonly overlap: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly explanation: string;
}

interface NormalizedPlacement {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly startMs: number;
  readonly endMs: number;
  readonly roomId: string | null;
  readonly trackIds: readonly string[];
  readonly speakerIds: readonly string[];
}

const CONFLICT_ORDER: Readonly<Record<AgendaConflictType, number>> = {
  "event-boundary": 0,
  room: 1,
  track: 2,
  speaker: 3,
};

function requireInstant(value: Date, field: string): number {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${field} must be a valid Date.`);
  return milliseconds;
}

function requireIdentifier(value: string, field: string): string {
  const identifier = value.trim();
  if (identifier === "") throw new TypeError(`${field} must not be empty.`);
  return identifier;
}

function uniqueIdentifiers(values: readonly string[] | undefined, field: string): readonly string[] {
  const identifiers = (values ?? []).map((value) => requireIdentifier(value, field));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new TypeError(`${field} must contain each identifier at most once.`);
  }
  return identifiers.toSorted();
}

function normalizePlacement(placement: AgendaPlacement): NormalizedPlacement {
  const id = requireIdentifier(placement.id, "placement.id");
  const startMs = requireInstant(placement.startsAt, `placement ${id} startsAt`);
  const endMs = requireInstant(placement.endsAt, `placement ${id} endsAt`);
  if (startMs >= endMs) throw new TypeError(`placement ${id} must end after it starts.`);

  return {
    id,
    startsAt: new Date(startMs),
    endsAt: new Date(endMs),
    startMs,
    endMs,
    roomId: placement.roomId ? requireIdentifier(placement.roomId, `placement ${id} roomId`) : null,
    trackIds: uniqueIdentifiers(placement.trackIds, `placement ${id} trackIds`),
    speakerIds: uniqueIdentifiers(placement.speakerIds, `placement ${id} speakerIds`),
  };
}

function localTime(milliseconds: number, timezone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(milliseconds)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}

function overlapWindow(left: NormalizedPlacement, right: NormalizedPlacement): [number, number] | null {
  const startsAt = Math.max(left.startMs, right.startMs);
  const endsAt = Math.min(left.endMs, right.endMs);
  return startsAt < endsAt ? [startsAt, endsAt] : null;
}

function sharedIdentifiers(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightIds = new Set(right);
  return left.filter((identifier) => rightIds.has(identifier));
}

function compareConflicts(left: AgendaConflict, right: AgendaConflict): number {
  return (
    left.overlap.startsAt.getTime() - right.overlap.startsAt.getTime() ||
    left.overlap.endsAt.getTime() - right.overlap.endsAt.getTime() ||
    left.placementIds.join("\u0000").localeCompare(right.placementIds.join("\u0000")) ||
    CONFLICT_ORDER[left.type] - CONFLICT_ORDER[right.type] ||
    (left.resourceId ?? "").localeCompare(right.resourceId ?? "")
  );
}

function pairConflict(
  type: Exclude<AgendaConflictType, "event-boundary">,
  resourceId: string,
  left: NormalizedPlacement,
  right: NormalizedPlacement,
  startsAt: number,
  endsAt: number,
  timezone: string,
): AgendaConflict {
  return {
    type,
    placementIds: [left.id, right.id],
    resourceId,
    overlap: { startsAt: new Date(startsAt), endsAt: new Date(endsAt) },
    explanation: `Placements ${left.id} and ${right.id} overlap on ${type} ${resourceId} from ${localTime(startsAt, timezone)} to ${localTime(endsAt, timezone)} (${timezone}).`,
  };
}

export function validateAgendaConflicts(
  bounds: AgendaBounds,
  placements: readonly AgendaPlacement[],
): readonly AgendaConflict[] {
  const eventStartMs = requireInstant(bounds.startsAt, "event startsAt");
  const eventEndMs = requireInstant(bounds.endsAt, "event endsAt");
  if (eventStartMs >= eventEndMs) throw new TypeError("The event must end after it starts.");
  try {
    Temporal.Now.instant().toZonedDateTimeISO(bounds.timezone);
  } catch {
    throw new TypeError("event timezone must be a valid IANA time-zone identifier.");
  }

  const normalized = placements.map(normalizePlacement).toSorted((left, right) => left.id.localeCompare(right.id));
  if (new Set(normalized.map(({ id }) => id)).size !== normalized.length) {
    throw new TypeError("placement.id must be unique within an agenda.");
  }

  const conflicts: AgendaConflict[] = [];
  for (const placement of normalized) {
    if (placement.startMs < eventStartMs) {
      const endsAt = Math.min(placement.endMs, eventStartMs);
      conflicts.push({
        type: "event-boundary",
        placementIds: [placement.id],
        resourceId: null,
        overlap: { startsAt: new Date(placement.startMs), endsAt: new Date(endsAt) },
        explanation: `Placement ${placement.id} starts before the event opens at ${localTime(eventStartMs, bounds.timezone)} (${bounds.timezone}).`,
      });
    }
    if (placement.endMs > eventEndMs) {
      const startsAt = Math.max(placement.startMs, eventEndMs);
      conflicts.push({
        type: "event-boundary",
        placementIds: [placement.id],
        resourceId: null,
        overlap: { startsAt: new Date(startsAt), endsAt: new Date(placement.endMs) },
        explanation: `Placement ${placement.id} ends after the event closes at ${localTime(eventEndMs, bounds.timezone)} (${bounds.timezone}).`,
      });
    }
  }

  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    const left = normalized[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const right = normalized[rightIndex];
      if (!right) continue;
      const overlap = overlapWindow(left, right);
      if (!overlap) continue;
      const [startsAt, endsAt] = overlap;

      if (left.roomId !== null && left.roomId === right.roomId) {
        conflicts.push(pairConflict("room", left.roomId, left, right, startsAt, endsAt, bounds.timezone));
      }
      for (const trackId of sharedIdentifiers(left.trackIds, right.trackIds)) {
        conflicts.push(pairConflict("track", trackId, left, right, startsAt, endsAt, bounds.timezone));
      }
      for (const speakerId of sharedIdentifiers(left.speakerIds, right.speakerIds)) {
        conflicts.push(pairConflict("speaker", speakerId, left, right, startsAt, endsAt, bounds.timezone));
      }
    }
  }

  return conflicts.toSorted(compareConflicts);
}
