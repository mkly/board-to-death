import ExcelJS from "exceljs";

import { RepositoryError } from "../events/repositories.ts";
import { validateSpeakerProfileInput } from "./repositories.ts";
import { Readable } from "node:stream";

export interface ParsedSpeakerCsvRow {
  readonly rowNumber: number;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly jobTitle: string | null;
  readonly organization: string | null;
  readonly biography: string | null;
  readonly parseErrors: readonly string[];
}

export interface SpeakerCsvPayload {
  readonly rowNumber: number;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly jobTitle: string | null;
  readonly organization: string | null;
  readonly biography: string | null;
}

export interface SpeakerCsvPreviewRow {
  readonly rowNumber: number;
  readonly name: string;
  readonly email: string;
  readonly outcome: "created" | "skipped" | "rejected";
  readonly errors: readonly string[];
  readonly payload?: SpeakerCsvPayload;
}

const HEADER_ALIASES = {
  name: ["name", "full_name", "full name"],
  givenName: ["given_name", "given name", "first_name", "first name"],
  familyName: ["family_name", "family name", "last_name", "last name", "surname"],
  email: ["email", "email_address", "email address"],
  jobTitle: ["title", "job_title", "job title"],
  organization: ["company", "organization", "organisation"],
  biography: ["bio", "biography"],
} as const;

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text.trim();
  return String(value).trim();
}

function normalizedHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
}

function headerIndex(headers: readonly string[], aliases: readonly string[]): number | undefined {
  const normalizedAliases = new Set(aliases.map(normalizedHeader));
  const index = headers.findIndex((header) => normalizedAliases.has(normalizedHeader(header)));
  return index < 0 ? undefined : index + 1;
}

function splitName(name: string): { readonly givenName: string; readonly familyName: string } | null {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { givenName: parts.slice(0, -1).join(" "), familyName: parts.at(-1) ?? "" };
}

function optional(value: string): string | null {
  return value === "" ? null : value;
}

export async function parseSpeakerCsv(text: string): Promise<readonly ParsedSpeakerCsvRow[]> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = await workbook.csv.read(Readable.from([text]));
  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) => cellText(headerRow.getCell(index + 1)));
  const columns = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, headerIndex(headers, aliases)]),
  ) as Readonly<Record<keyof typeof HEADER_ALIASES, number | undefined>>;

  if (columns.email === undefined) throw new Error("The CSV needs an email column.");
  if (columns.name === undefined && (columns.givenName === undefined || columns.familyName === undefined)) {
    throw new Error("The CSV needs a name column or both given_name and family_name columns.");
  }

  const read = (row: ExcelJS.Row, column: number | undefined) =>
    column === undefined ? "" : cellText(row.getCell(column));
  const rows: ParsedSpeakerCsvRow[] = [];
  const seenEmails = new Map<string, number>();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const email = read(row, columns.email).toLowerCase();
    const fullName = read(row, columns.name);
    const split = fullName === "" ? null : splitName(fullName);
    const givenName = columns.givenName === undefined ? (split?.givenName ?? "") : read(row, columns.givenName);
    const familyName = columns.familyName === undefined ? (split?.familyName ?? "") : read(row, columns.familyName);
    const values = [
      email,
      fullName,
      givenName,
      familyName,
      read(row, columns.jobTitle),
      read(row, columns.organization),
      read(row, columns.biography),
    ];
    if (values.every((value) => value === "")) return;

    const parseErrors: string[] = [];
    if (fullName !== "" && split === null && columns.givenName === undefined) {
      parseErrors.push("name must include both a given and family name.");
    }
    const firstRow = seenEmails.get(email);
    if (email !== "" && firstRow !== undefined) parseErrors.push(`email duplicates row ${firstRow}.`);
    else if (email !== "") seenEmails.set(email, rowNumber);

    rows.push({
      rowNumber,
      email,
      givenName,
      familyName,
      jobTitle: optional(read(row, columns.jobTitle)),
      organization: optional(read(row, columns.organization)),
      biography: optional(read(row, columns.biography)),
      parseErrors,
    });
  });
  if (rows.length === 0) throw new Error("The CSV does not contain any speaker rows.");
  return rows;
}

export function previewSpeakerCsvRows(
  rows: readonly ParsedSpeakerCsvRow[],
  existingEmails: ReadonlySet<string>,
): readonly SpeakerCsvPreviewRow[] {
  return rows.map((row) => {
    const name = `${row.givenName} ${row.familyName}`.trim() || "Unnamed speaker";
    if (row.parseErrors.length > 0) {
      return { rowNumber: row.rowNumber, name, email: row.email, outcome: "rejected", errors: row.parseErrors };
    }
    try {
      const profile = validateSpeakerProfileInput(row);
      if (existingEmails.has(profile.email)) {
        return {
          rowNumber: row.rowNumber,
          name,
          email: profile.email,
          outcome: "skipped",
          errors: ["A speaker with this email is already in the event roster."],
        };
      }
      return {
        rowNumber: row.rowNumber,
        name,
        email: profile.email,
        outcome: "created",
        errors: [],
        payload: {
          rowNumber: row.rowNumber,
          email: profile.email,
          givenName: profile.givenName,
          familyName: profile.familyName,
          jobTitle: profile.jobTitle,
          organization: profile.organization,
          biography: profile.biography,
        },
      };
    } catch (error) {
      return {
        rowNumber: row.rowNumber,
        name,
        email: row.email,
        outcome: "rejected",
        errors: [error instanceof RepositoryError ? error.message : "The speaker row is invalid."],
      };
    }
  });
}
