import ExcelJS from "exceljs";

import {
  type CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldType,
  type Prisma,
  type PrismaClient,
  ProgramSessionKind,
  SpreadsheetImportChangeAction,
  SpreadsheetImportEntityType,
} from "../../generated/prisma/client.ts";
import {
  type CustomFieldInputValue,
  setCustomFieldValues,
  validateCustomFieldValue,
} from "../custom-fields/repositories.ts";
import { RepositoryError } from "../events/repositories.ts";
import { Readable } from "node:stream";

export const MAX_IMPORT_ROWS = 500;
// A full 500-row commit issues thousands of statements, so Prisma's 5s
// interactive-transaction default aborts it long before it finishes.
const IMPORT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 };
export const MAX_IMPORT_BYTES = 1_000_000;
export const SKIP_COLUMN = "__skip__";

export interface SpreadsheetData {
  readonly headers: readonly string[];
  readonly rows: readonly SpreadsheetSourceRow[];
}

export interface SpreadsheetSourceRow {
  readonly rowNumber: number;
  readonly values: Readonly<Record<string, string>>;
}

export interface ImportFieldOption {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly custom: boolean;
}

export interface ImportPreviewRow {
  readonly rowNumber: number;
  readonly identity: string;
  readonly outcome: "created" | "updated" | "rejected";
  readonly errors: readonly string[];
}

export interface ImportPreview {
  readonly rows: readonly ImportPreviewRow[];
  readonly created: number;
  readonly updated: number;
  readonly rejected: number;
}

export interface CommitSpreadsheetImportInput {
  readonly eventId: string;
  readonly actorId: string;
  readonly entityType: SpreadsheetImportEntityType;
  readonly fileName: string;
  readonly mapping: Readonly<Record<string, string>>;
  readonly spreadsheet: SpreadsheetData;
}

interface PreparedCustomValue {
  readonly definitionId: string;
  readonly value: CustomFieldInputValue;
}

interface PreparedContactRow {
  readonly entityType: "CONTACT";
  readonly rowNumber: number;
  readonly existingId: string | null;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organization: string | null;
  readonly jobTitle: string | null;
  readonly phone: string | null;
  readonly customValues: readonly PreparedCustomValue[];
}

interface PreparedSessionRow {
  readonly entityType: "PROGRAM_SESSION";
  readonly rowNumber: number;
  readonly existingId: string | null;
  readonly nextVersionNumber: number;
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly trackId: string | null;
  readonly customValues: readonly PreparedCustomValue[];
}

type PreparedRow = PreparedContactRow | PreparedSessionRow;
type ImportClient = PrismaClient | Prisma.TransactionClient;

const CONTACT_FIELDS: readonly ImportFieldOption[] = [
  { key: "email", label: "Email", required: true, custom: false },
  { key: "givenName", label: "Given name", required: true, custom: false },
  { key: "familyName", label: "Family name", required: true, custom: false },
  { key: "organization", label: "Organization", required: false, custom: false },
  { key: "jobTitle", label: "Job title", required: false, custom: false },
  { key: "phone", label: "Phone", required: false, custom: false },
];

const SESSION_FIELDS: readonly ImportFieldOption[] = [
  { key: "title", label: "Title", required: true, custom: false },
  { key: "description", label: "Description", required: false, custom: false },
  { key: "durationMinutes", label: "Duration (minutes)", required: true, custom: false },
  { key: "track", label: "Track name", required: false, custom: false },
];

function spreadsheetCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "result" in value && value.result !== undefined) return String(value.result).trim();
  return cell.text.trim();
}

export async function parseSpreadsheet(fileName: string, bytes: Uint8Array): Promise<SpreadsheetData> {
  const extension = fileName.toLocaleLowerCase().split(".").at(-1);
  const workbook = new ExcelJS.Workbook();
  let worksheet: ExcelJS.Worksheet | undefined;
  if (extension === "csv") {
    worksheet = await workbook.csv.read(Readable.from([Buffer.from(bytes)]));
  } else if (extension === "xlsx") {
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
    worksheet = workbook.worksheets[0];
  } else {
    throw new RepositoryError("invalid-input", "Choose a CSV or XLSX file.");
  }
  if (!worksheet) throw new RepositoryError("invalid-input", "The spreadsheet does not contain a worksheet.");

  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) =>
    spreadsheetCellText(headerRow.getCell(index + 1)).trim(),
  );
  if (headers.length === 0) throw new RepositoryError("invalid-input", "The spreadsheet needs a header row.");
  if (headers.some((header) => header === "")) {
    throw new RepositoryError("invalid-input", "Every spreadsheet column needs a header name.");
  }
  if (new Set(headers.map((header) => header.toLocaleLowerCase())).size !== headers.length) {
    throw new RepositoryError("invalid-input", "Spreadsheet column names must be unique.");
  }

  const rows: SpreadsheetSourceRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = Object.fromEntries(
      headers.map((header, index) => [header, spreadsheetCellText(row.getCell(index + 1))]),
    );
    if (Object.values(values).every((value) => value === "")) return;
    rows.push({ rowNumber, values });
  });
  if (rows.length === 0) throw new RepositoryError("invalid-input", "The spreadsheet does not contain any data rows.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new RepositoryError("invalid-input", `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  }
  return { headers, rows };
}

function entityCustomFieldType(entityType: SpreadsheetImportEntityType): CustomFieldEntityType {
  return entityType === SpreadsheetImportEntityType.CONTACT
    ? CustomFieldEntityType.CONTACT
    : CustomFieldEntityType.PROGRAM_SESSION;
}

// A FILE value only exists once a file has been uploaded, so an upload-only
// definition can never be satisfied by a spreadsheet cell. Excluding it here
// also keeps a *required* FILE definition from making every import impossible:
// validateMapping would demand a column for a target no cell could ever fill.
async function importableDefinitions(
  client: ImportClient,
  eventId: string,
  entityType: SpreadsheetImportEntityType,
): Promise<readonly CustomFieldDefinition[]> {
  return client.customFieldDefinition.findMany({
    where: { eventId, entityType: entityCustomFieldType(entityType), type: { not: CustomFieldType.FILE } },
    orderBy: { position: "asc" },
  });
}

export async function listImportFields(
  client: ImportClient,
  eventId: string,
  entityType: SpreadsheetImportEntityType,
): Promise<readonly ImportFieldOption[]> {
  const definitions = await importableDefinitions(client, eventId, entityType);
  return [
    ...(entityType === SpreadsheetImportEntityType.CONTACT ? CONTACT_FIELDS : SESSION_FIELDS),
    ...definitions.map((definition) => ({
      key: `custom:${definition.id}`,
      label: `${definition.label} (custom)`,
      required: definition.required,
      custom: true,
    })),
  ];
}

function mappedValue(row: SpreadsheetSourceRow, mapping: Readonly<Record<string, string>>, fieldKey: string): string {
  const source = Object.entries(mapping).find(([, target]) => target === fieldKey)?.[0];
  return source ? (row.values[source] ?? "").trim() : "";
}

function optional(value: string): string | null {
  return value === "" ? null : value;
}

function previewOutcome(hasErrors: boolean, exists: boolean): ImportPreviewRow["outcome"] {
  if (hasErrors) return "rejected";
  return exists ? "updated" : "created";
}

// Never called with an empty `raw`: customValuesForRow handles blank cells.
function parseCustomValue(definition: CustomFieldDefinition, raw: string): CustomFieldInputValue {
  if (definition.type === CustomFieldType.FILE) {
    throw new RepositoryError("invalid-input", `${definition.label} is upload-only and cannot be imported.`);
  }
  if (definition.type === CustomFieldType.NUMBER) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new RepositoryError("invalid-input", `${definition.label} must be a number.`);
    return value;
  }
  if (definition.type === CustomFieldType.CHECKBOX) {
    const normalized = raw.toLocaleLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
    throw new RepositoryError("invalid-input", `${definition.label} must be true/false, yes/no, or 1/0.`);
  }
  if (definition.type === CustomFieldType.MULTI_SELECT) {
    return raw
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return raw;
}

function validateMapping(
  headers: readonly string[],
  fields: readonly ImportFieldOption[],
  mapping: Readonly<Record<string, string>>,
): readonly string[] {
  const errors: string[] = [];
  const fieldKeys = new Set(fields.map(({ key }) => key));
  const targets = headers.map((header) => mapping[header] ?? SKIP_COLUMN).filter((target) => target !== SKIP_COLUMN);
  if (targets.some((target) => !fieldKeys.has(target)))
    errors.push("The mapping contains a field that is not available.");
  if (new Set(targets).size !== targets.length) errors.push("Each destination field can be mapped only once.");
  for (const field of fields.filter(({ required }) => required)) {
    if (!targets.includes(field.key)) errors.push(`Map a column to ${field.label}.`);
  }
  return errors;
}

function customValuesForRow(
  row: SpreadsheetSourceRow,
  mapping: Readonly<Record<string, string>>,
  definitions: readonly CustomFieldDefinition[],
  errors: string[],
): readonly PreparedCustomValue[] {
  const values: PreparedCustomValue[] = [];
  for (const definition of definitions) {
    const fieldKey = `custom:${definition.id}`;
    const source = Object.entries(mapping).find(([, target]) => target === fieldKey)?.[0];
    if (!source) continue;
    const raw = (row.values[source] ?? "").trim();
    // A blank cell leaves whatever is already stored alone. Sending "" instead
    // would reject the row for every non-text type, because the shared
    // validator only accepts an empty string for text-shaped fields.
    if (raw === "") {
      if (definition.required) errors.push(`${definition.label} is required.`);
      continue;
    }
    try {
      const value = parseCustomValue(definition, raw);
      validateCustomFieldValue(definition, value);
      values.push({ definitionId: definition.id, value });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${definition.label} is invalid.`);
    }
  }
  return values;
}

async function prepareRows(
  client: ImportClient,
  eventId: string,
  entityType: SpreadsheetImportEntityType,
  mapping: Readonly<Record<string, string>>,
  spreadsheet: SpreadsheetData,
): Promise<{ readonly rows: readonly PreparedRow[]; readonly preview: ImportPreview }> {
  const [fields, definitions] = await Promise.all([
    listImportFields(client, eventId, entityType),
    importableDefinitions(client, eventId, entityType),
  ]);
  const mappingErrors = validateMapping(spreadsheet.headers, fields, mapping);
  if (mappingErrors.length > 0) {
    return {
      rows: [],
      preview: {
        rows: spreadsheet.rows.map(({ rowNumber }) => ({
          rowNumber,
          identity: "—",
          outcome: "rejected",
          errors: mappingErrors,
        })),
        created: 0,
        updated: 0,
        rejected: spreadsheet.rows.length,
      },
    };
  }

  const contacts =
    entityType === SpreadsheetImportEntityType.CONTACT
      ? await client.contact.findMany({ where: { eventId }, select: { id: true, email: true } })
      : [];
  const sessions =
    entityType === SpreadsheetImportEntityType.PROGRAM_SESSION
      ? await client.programSession.findMany({
          where: { eventId, archivedAt: null },
          select: { id: true, versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        })
      : [];
  const contactByEmail = new Map(contacts.map((contact) => [contact.email.toLocaleLowerCase(), contact.id]));
  const sessionsByTitle = new Map<string, { id: string; versionNumber: number }[]>();
  for (const session of sessions) {
    const version = session.versions[0];
    if (!version) continue;
    const key = version.title.trim().toLocaleLowerCase();
    sessionsByTitle.set(key, [
      ...(sessionsByTitle.get(key) ?? []),
      { id: session.id, versionNumber: version.versionNumber },
    ]);
  }
  const tracks = await client.track.findMany({ where: { eventId }, select: { id: true, name: true } });
  const trackByName = new Map(tracks.map((track) => [track.name.trim().toLocaleLowerCase(), track.id]));
  const seen = new Map<string, number>();
  const prepared: PreparedRow[] = [];
  const previewRows: ImportPreviewRow[] = [];

  for (const row of spreadsheet.rows) {
    const errors: string[] = [];
    const customValues = customValuesForRow(row, mapping, definitions, errors);
    if (entityType === SpreadsheetImportEntityType.CONTACT) {
      const email = mappedValue(row, mapping, "email").toLocaleLowerCase();
      const givenName = mappedValue(row, mapping, "givenName");
      const familyName = mappedValue(row, mapping, "familyName");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email must be a valid address.");
      if (!givenName) errors.push("Given name is required.");
      if (!familyName) errors.push("Family name is required.");
      const firstRow = seen.get(email);
      if (firstRow) errors.push(`Email duplicates row ${firstRow}.`);
      else if (email) seen.set(email, row.rowNumber);
      const existingId = contactByEmail.get(email) ?? null;
      if (errors.length === 0) {
        prepared.push({
          entityType: "CONTACT",
          rowNumber: row.rowNumber,
          existingId,
          email,
          givenName,
          familyName,
          organization: optional(mappedValue(row, mapping, "organization")),
          jobTitle: optional(mappedValue(row, mapping, "jobTitle")),
          phone: optional(mappedValue(row, mapping, "phone")),
          customValues,
        });
      }
      previewRows.push({
        rowNumber: row.rowNumber,
        identity: email || "—",
        outcome: previewOutcome(errors.length > 0, Boolean(existingId)),
        errors,
      });
      continue;
    }

    const title = mappedValue(row, mapping, "title");
    const identity = title.trim().toLocaleLowerCase();
    const durationText = mappedValue(row, mapping, "durationMinutes");
    const durationMinutes = Number(durationText);
    if (!title) errors.push("Title is required.");
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1_440) {
      errors.push("Duration must be a whole number between 1 and 1,440.");
    }
    const firstRow = seen.get(identity);
    if (firstRow) errors.push(`Title duplicates row ${firstRow}.`);
    else if (identity) seen.set(identity, row.rowNumber);
    const matchingSessions = sessionsByTitle.get(identity) ?? [];
    if (matchingSessions.length > 1)
      errors.push("More than one existing session has this title; rename it before importing.");
    const trackName = mappedValue(row, mapping, "track");
    const trackId = trackName ? trackByName.get(trackName.toLocaleLowerCase()) : null;
    if (trackName && !trackId) errors.push(`Track ${trackName} was not found in this event.`);
    const existing = matchingSessions[0] ?? null;
    if (errors.length === 0) {
      prepared.push({
        entityType: "PROGRAM_SESSION",
        rowNumber: row.rowNumber,
        existingId: existing?.id ?? null,
        nextVersionNumber: (existing?.versionNumber ?? 0) + 1,
        title,
        description: optional(mappedValue(row, mapping, "description")),
        durationMinutes,
        trackId: trackId ?? null,
        customValues,
      });
    }
    previewRows.push({
      rowNumber: row.rowNumber,
      identity: title || "—",
      outcome: previewOutcome(errors.length > 0, Boolean(existing)),
      errors,
    });
  }

  return {
    rows: prepared,
    preview: {
      rows: previewRows,
      created: previewRows.filter(({ outcome }) => outcome === "created").length,
      updated: previewRows.filter(({ outcome }) => outcome === "updated").length,
      rejected: previewRows.filter(({ outcome }) => outcome === "rejected").length,
    },
  };
}

export async function previewSpreadsheetImport(
  client: PrismaClient,
  eventId: string,
  entityType: SpreadsheetImportEntityType,
  mapping: Readonly<Record<string, string>>,
  spreadsheet: SpreadsheetData,
): Promise<ImportPreview> {
  return (await prepareRows(client, eventId, entityType, mapping, spreadsheet)).preview;
}

async function persistPreparedRow(
  transaction: Prisma.TransactionClient,
  eventId: string,
  row: PreparedRow,
): Promise<{ readonly targetId: string; readonly action: SpreadsheetImportChangeAction }> {
  if (row.entityType === "CONTACT") {
    const data = {
      email: row.email,
      givenName: row.givenName,
      familyName: row.familyName,
      organization: row.organization,
      jobTitle: row.jobTitle,
      phone: row.phone,
    };
    const contact = row.existingId
      ? await transaction.contact.update({ where: { eventId_id: { eventId, id: row.existingId } }, data })
      : await transaction.contact.create({ data: { eventId, ...data } });
    await setCustomFieldValues(
      transaction,
      eventId,
      { entityType: "CONTACT", contactId: contact.id },
      row.customValues,
    );
    return {
      targetId: contact.id,
      action: row.existingId ? SpreadsheetImportChangeAction.UPDATED : SpreadsheetImportChangeAction.CREATED,
    };
  }

  const session = row.existingId
    ? await transaction.programSession.findUniqueOrThrow({ where: { eventId_id: { eventId, id: row.existingId } } })
    : await transaction.programSession.create({ data: { eventId, kind: ProgramSessionKind.MANUAL } });
  await transaction.programSessionVersion.create({
    data: {
      eventId,
      sessionId: session.id,
      versionNumber: row.nextVersionNumber,
      title: row.title,
      description: row.description,
      durationMinutes: row.durationMinutes,
      trackId: row.trackId,
    },
  });
  await setCustomFieldValues(
    transaction,
    eventId,
    { entityType: "PROGRAM_SESSION", sessionId: session.id },
    row.customValues,
  );
  return {
    targetId: session.id,
    action: row.existingId ? SpreadsheetImportChangeAction.UPDATED : SpreadsheetImportChangeAction.CREATED,
  };
}

export async function commitSpreadsheetImport(
  client: PrismaClient,
  input: CommitSpreadsheetImportInput,
): Promise<{ readonly importId: string; readonly preview: ImportPreview }> {
  return client.$transaction(async (transaction) => {
    const prepared = await prepareRows(transaction, input.eventId, input.entityType, input.mapping, input.spreadsheet);
    if (prepared.preview.rejected > 0) {
      throw new RepositoryError("invalid-input", "The spreadsheet has rejected rows. Fix every row before committing.");
    }
    const audit = await transaction.spreadsheetImport.create({
      data: {
        eventId: input.eventId,
        entityType: input.entityType,
        fileName: input.fileName,
        mapping: input.mapping,
        actorId: input.actorId,
      },
    });
    for (const row of prepared.rows) {
      const result = await persistPreparedRow(transaction, input.eventId, row);
      await transaction.spreadsheetImportChange.create({
        data: {
          eventId: input.eventId,
          importId: audit.id,
          rowNumber: row.rowNumber,
          targetId: result.targetId,
          action: result.action,
        },
      });
    }
    return { importId: audit.id, preview: prepared.preview };
  }, IMPORT_TRANSACTION_OPTIONS);
}
