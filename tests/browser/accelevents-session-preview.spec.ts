import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/accelevents-session-preview.ts");

interface BrowserFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly sessionToken: string;
}

async function runFixture(action: "setup" | "cleanup", eventId?: string): Promise<BrowserFixture | null> {
  const { stdout } = await execFileAsync(process.execPath, [fixtureScript, action, ...(eventId ? [eventId] : [])], {
    env: process.env,
  });
  return action === "setup" ? (JSON.parse(stdout) as BrowserFixture) : null;
}

test.describe("Accelevents session preview", () => {
  test.describe.configure({ mode: "serial" });
  let fixture: BrowserFixture;

  test.beforeAll(async () => {
    const created = await runFixture("setup");
    if (!created) throw new Error("Expected the Accelevents browser fixture to be created.");
    fixture = created;
  });

  test.afterAll(async () => {
    if (fixture) await runFixture("cleanup", fixture.eventId);
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "better-auth.session_token", value: fixture.sessionToken, url: baseURL },
      { name: "gatherpulse_active_event", value: fixture.eventId, url: baseURL },
    ]);
  });

  test("previews, paginates, remaps, and downloads the exact formula-safe fallback", async ({ page }) => {
    await page.goto(`/dashboard/events/${fixture.eventSlug}/integrations`);
    const preview = page.getByRole("region", { name: "Accelevents session preview" });
    await expect(preview.getByRole("heading", { name: "Accelevents session preview" })).toBeVisible();
    await expect(preview.getByText("11", { exact: true }).first()).toBeVisible();
    await expect(preview.getByText("=Formula-safe keynote")).toBeVisible();

    await preview.getByRole("link", { name: "Next" }).click();
    await expect(preview.getByText("Session 11", { exact: true })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await preview.getByRole("link", { name: "Download authorized CSV" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toContain("'=Formula-safe keynote");

    await preview.getByLabel("Accelevents title").click();
    await page.getByRole("option", { name: "Event name" }).click();
    await preview.getByLabel("Accelevents description").click();
    await page.getByRole("option", { name: "Event theme" }).click();
    await preview.getByLabel("Accelevents speakers").click();
    await page.getByRole("option", { name: "Do not send" }).click();
    await preview.getByRole("button", { name: "Save mapping" }).click();

    await expect(preview.getByText("Mapping version 1 saved.")).toBeVisible();
    await expect(preview.getByText("mapping v1")).toBeVisible();
    await expect(preview.getByText("Browser Mapping Summit", { exact: true }).first()).toBeVisible();
  });
});
