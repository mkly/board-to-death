import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { CfpSubmissionKind, CfpSubmissionStatus } from "@/generated/prisma/client";

import { createSubmissionCsv, createSubmissionFileBundle, createSubmissionXlsx } from "./exports";
import type { CfpSubmissionListItem } from "./submissions";

function submission(overrides: Partial<CfpSubmissionListItem> = {}): CfpSubmissionListItem {
  return {
    id: "submission-1",
    kind: CfpSubmissionKind.ABSTRACT,
    status: CfpSubmissionStatus.SUBMITTED,
    submittedAt: new Date("2027-03-13T18:30:00.000Z"),
    updatedAt: new Date("2027-03-13T18:30:00.000Z"),
    formTitle: "Board Game Design CFP",
    categories: [],
    applicants: [{ id: "speaker-1", name: "Lex", email: "lex@example.test" }],
    assignees: [],
    answers: {},
    averageScore: null,
    completedReviews: 0,
    totalReviews: 0,
    ...overrides,
  };
}

describe("submission exports", () => {
  it("quotes CSV values and neutralizes spreadsheet formulas in built-in and custom columns", () => {
    const bytes = createSubmissionCsv({
      columns: ["formTitle", "answer:budget"],
      customLabels: { budget: "Budget" },
      items: [submission({ formTitle: '=HYPERLINK("https://example.test")', answers: { budget: "+1000" } })],
    });
    const csv = new TextDecoder().decode(bytes);

    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).toContain('"\'+1000"');
  });

  it("neutralizes a custom question label that begins with a formula character", () => {
    const bytes = createSubmissionCsv({
      columns: ["answer:budget"],
      customLabels: { budget: "=SUM(A1:A9)" },
      items: [submission({ answers: { budget: "1000" } })],
    });
    const csv = new TextDecoder().decode(bytes);
    const [header] = csv.split("\r\n");

    expect(header).toBe('"\'=SUM(A1:A9)"');
  });

  it("writes the selected columns and formula-neutralized values to an Excel workbook", async () => {
    const bytes = await createSubmissionXlsx({
      columns: ["formTitle", "applicant", "answer:budget"],
      customLabels: { budget: "Budget" },
      items: [submission({ formTitle: "Filtered proposal", answers: { budget: "=2+2" } })],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
    const worksheet = workbook.getWorksheet("Submissions");

    expect(worksheet?.getRow(1).values).toEqual([undefined, "Submission", "Applicant", "Budget"]);
    expect(worksheet?.getRow(2).values).toEqual([undefined, "Filtered proposal", "Lex", "'=2+2"]);
  });

  it("includes only authorized submission attachments under safe, unique paths with a manifest", async () => {
    const bytes = await createSubmissionFileBundle(
      [submission()],
      [
        {
          submissionId: "submission-1",
          fileName: "../slides.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([1]),
        },
        {
          submissionId: "submission-1",
          fileName: "slides.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([2]),
        },
        {
          submissionId: "other-event-submission",
          fileName: "secret.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([3]),
        },
        {
          submissionId: "outside-filtered-results",
          fileName: "omitted.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([4]),
        },
      ],
    );
    const zip = await JSZip.loadAsync(bytes);
    const paths = Object.keys(zip.files).sort();

    expect(paths).toContain("submission-1/slides.pdf");
    expect(paths).toContain("submission-1/2-slides.pdf");
    expect(paths.some((path) => path.includes("secret"))).toBe(false);
    expect(paths.some((path) => path.includes("omitted"))).toBe(false);
    const manifestFile = zip.file("manifest.json");
    expect(manifestFile).not.toBeNull();
    if (!manifestFile) throw new Error("The attachment manifest is missing.");
    const manifest = JSON.parse(await manifestFile.async("string")) as { files: unknown[] };
    expect(manifest.files).toHaveLength(2);
  });
});
