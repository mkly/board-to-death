import ExcelJS from "exceljs";

import { Readable } from "node:stream";

export const ADMIN_INTAKE_CSV_HEADERS = [
  "client_identifier",
  "kind",
  "status",
  "form_key",
  "title",
  "description",
  "duration_minutes",
  "track",
  "participant_emails",
  "category_keys",
  "answers_json",
] as const;

export interface AdminIntakeCsvRow {
  readonly rowNumber: number;
  readonly clientIdentifier: string;
  readonly kind: string;
  readonly status: string;
  readonly formKey: string;
  readonly title: string;
  readonly description: string;
  readonly durationMinutes: string;
  readonly track: string;
  readonly participantEmails: readonly string[];
  readonly categoryKeys: readonly string[];
  readonly answers: unknown;
  readonly parseErrors: readonly string[];
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text.trim();
  return String(value).trim();
}

function splitList(value: string): readonly string[] {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function parseAdminIntakeCsv(text: string): Promise<readonly AdminIntakeCsvRow[]> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = await workbook.csv.read(Readable.from([text]));
  const headerRow = worksheet.getRow(1);
  const headers = ADMIN_INTAKE_CSV_HEADERS.map((_, index) => cellText(headerRow.getCell(index + 1)).toLowerCase());
  const missing = ADMIN_INTAKE_CSV_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) throw new Error(`Missing required CSV columns: ${missing.join(", ")}.`);
  const columns = new Map(headers.map((header, index) => [header, index + 1]));
  const read = (row: ExcelJS.Row, header: (typeof ADMIN_INTAKE_CSV_HEADERS)[number]) =>
    cellText(row.getCell(columns.get(header) ?? -1));
  const rows: AdminIntakeCsvRow[] = [];
  const seenIdentifiers = new Map<string, number>();
  worksheet.eachRow((row, rowNumber) => {
    const empty = Array.from({ length: row.cellCount }, (_, index) => cellText(row.getCell(index + 1))).every(
      (value) => value === "",
    );
    if (rowNumber === 1 || empty) {
      return;
    }
    const errors: string[] = [];
    const identifier = read(row, "client_identifier").toLowerCase();
    const firstRow = seenIdentifiers.get(identifier);
    if (identifier === "") errors.push("client_identifier is required.");
    else if (firstRow) errors.push(`client_identifier duplicates row ${firstRow}.`);
    else seenIdentifiers.set(identifier, rowNumber);
    const answersText = read(row, "answers_json");
    let answers: unknown = {};
    if (answersText !== "") {
      try {
        answers = JSON.parse(answersText);
        if (!answers || Array.isArray(answers) || typeof answers !== "object") {
          errors.push("answers_json must be a JSON object.");
        }
      } catch {
        errors.push("answers_json must contain valid JSON.");
      }
    }
    rows.push({
      rowNumber,
      clientIdentifier: identifier,
      kind: read(row, "kind").toLowerCase(),
      status: read(row, "status").toUpperCase(),
      formKey: read(row, "form_key").toLowerCase(),
      title: read(row, "title"),
      description: read(row, "description"),
      durationMinutes: read(row, "duration_minutes"),
      track: read(row, "track"),
      participantEmails: splitList(read(row, "participant_emails")).map((email) => email.toLowerCase()),
      categoryKeys: splitList(read(row, "category_keys")).map((key) => key.toLowerCase()),
      answers,
      parseErrors: errors,
    });
  });
  if (rows.length === 0) throw new Error("The CSV file does not contain any intake rows.");
  return rows;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function adminIntakeCsvTemplate(): string {
  const examples = [
    [
      "abstract-001",
      "abstract",
      "SUBMITTED",
      "main-cfp",
      "",
      "",
      "",
      "",
      "alex@example.test|sam@example.test",
      "strategy",
      '{"title":"Designing safer game nights","summary":"A practical session."}',
    ],
    [
      "session-001",
      "guaranteed_session",
      "",
      "",
      "Opening keynote",
      "Welcome and opening remarks.",
      "30",
      "Main stage",
      "alex@example.test",
      "",
      "",
    ],
  ];
  return [ADMIN_INTAKE_CSV_HEADERS, ...examples]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}
