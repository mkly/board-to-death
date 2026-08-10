import { describe, expect, it } from "vitest";

import { parseSpeakerCsv, previewSpeakerCsvRows } from "./csv";

const FIXTURE = `name,email,title,company,bio
Priya Raman,priya.speaker@sbek-test.example.com,Principal Engineer,Latticework Systems,Platform leader
Marcus Okafor,marcus.speaker@sbek-test.example.com,Staff Developer Advocate,Cloudreach Labs,Developer advocate
Dana Kowalski,dana.speaker@sbek-test.example.com,Engineering Manager,Substrate,Engineering leader
`;

describe("speaker CSV import", () => {
  it("previews fixture rows and skips speakers already in the roster by email", async () => {
    const parsed = await parseSpeakerCsv(FIXTURE);
    const preview = previewSpeakerCsvRows(
      parsed,
      new Set(["priya.speaker@sbek-test.example.com", "marcus.speaker@sbek-test.example.com"]),
    );

    expect(preview.map(({ name, outcome }) => [name, outcome])).toEqual([
      ["Priya Raman", "skipped"],
      ["Marcus Okafor", "skipped"],
      ["Dana Kowalski", "created"],
    ]);
    expect(preview[2]?.payload).toMatchObject({
      email: "dana.speaker@sbek-test.example.com",
      givenName: "Dana",
      familyName: "Kowalski",
      jobTitle: "Engineering Manager",
      organization: "Substrate",
      biography: "Engineering leader",
    });
  });

  it("reports invalid and duplicate rows without accepting them", async () => {
    const parsed = await parseSpeakerCsv(
      `name,email\nSolo,invalid\nDana Kowalski,valid@example.test\nOther Name,valid@example.test\n`,
    );
    const preview = previewSpeakerCsvRows(parsed, new Set());

    expect(preview.map(({ outcome }) => outcome)).toEqual(["rejected", "created", "rejected"]);
    expect(preview[0]?.errors).toContain("name must include both a given and family name.");
    expect(preview[2]?.errors).toContain("email duplicates row 3.");
  });
});
