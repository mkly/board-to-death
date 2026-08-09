import ExcelJS from "exceljs";
import JSZip from "jszip";

import { columnLabel, type SubmissionColumnId } from "@/lib/cfp/submission-table";

import type { CfpSubmissionListItem } from "./submissions";

export interface SubmissionExportAttachment {
  readonly submissionId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface SubmissionExportTable {
  readonly columns: readonly SubmissionColumnId[];
  readonly customLabels: Readonly<Record<string, string>>;
  readonly items: readonly CfpSubmissionListItem[];
}

function neutralizeFormula(value: string): string {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

function cellValue(item: CfpSubmissionListItem, columnId: SubmissionColumnId): string {
  switch (columnId) {
    case "formTitle":
      return item.formTitle;
    case "applicant":
      return item.applicants.map(({ name }) => name).join(", ");
    case "email":
      return item.applicants.map(({ email }) => email).join(", ");
    case "kind":
      return item.kind;
    case "categories":
      return item.categories.map(({ label }) => label).join(", ");
    case "assignees":
      return item.assignees.map(({ displayName }) => displayName).join(", ");
    case "status":
      return item.status;
    case "submittedAt":
      return item.submittedAt?.toISOString() ?? "";
    case "updatedAt":
      return item.updatedAt.toISOString();
    case "averageScore":
      return item.averageScore === null ? "" : item.averageScore.toFixed(2);
    case "reviewProgress":
      return `${item.completedReviews}/${item.totalReviews}`;
    default:
      return item.answers[columnId.slice(7)] ?? "";
  }
}

export function submissionExportRows(table: SubmissionExportTable): readonly (readonly string[])[] {
  return [
    table.columns.map((column) => neutralizeFormula(columnLabel(column, table.customLabels))),
    ...table.items.map((item) => table.columns.map((column) => neutralizeFormula(cellValue(item, column)))),
  ];
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function createSubmissionCsv(table: SubmissionExportTable): Uint8Array {
  const body = submissionExportRows(table)
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return new TextEncoder().encode(`\uFEFF${body}\r\n`);
}

export async function createSubmissionXlsx(table: SubmissionExportTable): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Submissions", { views: [{ state: "frozen", ySplit: 1 }] });
  for (const row of submissionExportRows(table)) worksheet.addRow([...row]);
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach((column) => {
    column.width = Math.min(60, Math.max(12, ...(column.values ?? []).map((value) => String(value ?? "").length + 2)));
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function safeArchiveName(value: string): string {
  const base = value
    .split(/[\\/]/)
    .at(-1)
    ?.split("")
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
  return base && base !== "." && base !== ".." ? base.slice(0, 180) : "attachment";
}

export async function createSubmissionFileBundle(
  items: readonly CfpSubmissionListItem[],
  attachments: readonly SubmissionExportAttachment[],
): Promise<Uint8Array> {
  const authorizedIds = new Set(items.map(({ id }) => id));
  const zip = new JSZip();
  const usedNames = new Set<string>();
  const manifest: Array<{ submissionId: string; fileName: string; archivePath: string; contentType: string }> = [];

  for (const attachment of attachments) {
    if (!authorizedIds.has(attachment.submissionId)) continue;
    const baseName = safeArchiveName(attachment.fileName);
    let archivePath = `${attachment.submissionId}/${baseName}`;
    for (let suffix = 2; usedNames.has(archivePath); suffix += 1) {
      archivePath = `${attachment.submissionId}/${suffix}-${baseName}`;
    }
    usedNames.add(archivePath);
    zip.file(archivePath, attachment.bytes);
    manifest.push({
      submissionId: attachment.submissionId,
      fileName: baseName,
      archivePath,
      contentType: attachment.contentType,
    });
  }

  zip.file("manifest.json", JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
