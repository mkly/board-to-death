import { Temporal } from "temporal-polyfill";

export interface AgendaExportPlacement {
  readonly id: string;
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomId: string;
  readonly roomName: string;
  readonly trackIds: readonly string[];
  readonly trackNames: readonly string[];
  readonly speakerIds: readonly string[];
  readonly speakerNames: readonly string[];
}

function safeCell(value: string): string {
  const neutralized = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

function localLabel(value: Date, timezone: string): string {
  return Temporal.Instant.from(value.toISOString()).toZonedDateTimeISO(timezone).toPlainDateTime().toString();
}

export function createAgendaCsv(placements: readonly AgendaExportPlacement[], timezone: string): Uint8Array {
  const rows = [
    [
      "sessionId",
      "placementId",
      "sessionTitle",
      "startsAtUtc",
      "endsAtUtc",
      "eventTimezone",
      "startsAtLocal",
      "endsAtLocal",
      "roomId",
      "room",
      "trackIds",
      "tracks",
      "speakerIds",
      "speakers",
    ],
    ...placements.map((placement) => [
      placement.sessionId,
      placement.id,
      placement.sessionTitle,
      placement.startsAt.toISOString(),
      placement.endsAt.toISOString(),
      timezone,
      localLabel(placement.startsAt, timezone),
      localLabel(placement.endsAt, timezone),
      placement.roomId,
      placement.roomName,
      placement.trackIds.join("|"),
      placement.trackNames.join("|"),
      placement.speakerIds.join("|"),
      placement.speakerNames.join("|"),
    ]),
  ];
  return new TextEncoder().encode(`\uFEFF${rows.map((row) => row.map(safeCell).join(",")).join("\r\n")}\r\n`);
}
