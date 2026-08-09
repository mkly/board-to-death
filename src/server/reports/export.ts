import ExcelJS from "exceljs";

import type { ReportResult } from "./engine.ts";

function safeCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value);
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function reportExportRows(result: ReportResult): readonly (readonly (string | number | boolean)[])[] {
  return [
    result.columns.map(({ label }) => label),
    ...result.rows.map(({ values }) => result.columns.map(({ id }) => safeCell(values[id]))),
  ];
}

function csvCell(value: string | number | boolean): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function createReportCsv(result: ReportResult): Uint8Array {
  const body = reportExportRows(result)
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return new TextEncoder().encode(`\uFEFF${body}\r\n`);
}

export async function createReportXlsx(result: ReportResult): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Report", { views: [{ state: "frozen", ySplit: 1 }] });
  for (const row of reportExportRows(result)) worksheet.addRow([...row]);
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach((column) => {
    column.width = Math.min(60, Math.max(12, ...(column.values ?? []).map((value) => String(value ?? "").length + 2)));
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
