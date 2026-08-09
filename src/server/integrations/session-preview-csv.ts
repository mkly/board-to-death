import type { SessionPreviewRecord } from "./session-preview.ts";

const CSV_HEADER = [
  "localSessionId",
  "remoteSessionId",
  "title",
  "description",
  "speakerRemoteIds",
  "startsAt",
  "endsAt",
  "room",
  "tracks",
  "previewAction",
  "explanations",
] as const;

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvRow(record: SessionPreviewRecord): readonly string[] {
  return [
    record.localId,
    record.remoteId ?? "",
    record.title,
    record.description,
    record.speakerRemoteIds.join("|"),
    record.startsAt,
    record.endsAt,
    record.roomName,
    record.trackNames.join("|"),
    record.action,
    record.explanations.join(" | "),
  ];
}

/**
 * Renders the authorized outbound session dataset exactly as previewed, with
 * spreadsheet formula injection neutralized. It never contacts Accelevents.
 */
export function sessionPreviewCsv(records: readonly SessionPreviewRecord[]): string {
  return [[...CSV_HEADER], ...records.map(csvRow)]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}
