import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { execFileSync } from "node:child_process";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const fixturePath = "tests/browser/fixtures/published-agenda.ts";
let eventId = "";
let eventSlug = "";
let sessionId = "";

function runFixture(action: "setup" | "republish" | "unpublish" | "cleanup") {
  const output = execFileSync(
    process.execPath,
    ["--experimental-strip-types", fixturePath, action, eventId, sessionId],
    {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );
  return output === "" ? null : (JSON.parse(output) as { eventId: string; eventSlug: string; sessionId: string });
}

test.beforeAll(() => {
  const fixture = runFixture("setup");
  if (!fixture) throw new Error("Expected the published agenda fixture.");
  eventId = fixture.eventId;
  eventSlug = fixture.eventSlug;
  sessionId = fixture.sessionId;
});

test.afterAll(() => {
  if (eventId) runFixture("cleanup");
});

test("filters a responsive, isolated agenda and follows publication state", async ({ page }) => {
  test.setTimeout(120_000);
  const embedPath = `/embed/${eventSlug}?kind=agenda&theme=light&density=comfortable&filter=search&filter=day&filter=room&filter=track`;
  await page.goto(embedPath);

  await expect(page.getByRole("heading", { name: "Pacific Tabletop Summit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saturday, March 13, 2027" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sunday, March 14, 2027" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Opening strategy keynote" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Keynote mechanics demo" })).toBeVisible();
  await expect(page.getByText("Subsession of Opening strategy keynote")).toBeVisible();
  await expect(
    page.locator("[data-parent-session]").filter({ has: page.getByRole("link", { name: "Keynote mechanics demo" }) }),
  ).toBeVisible();
  await expect(page.getByText("10:00 AM–10:45 AM").first()).toBeVisible();
  await expect(page.getByText("America/Los_Angeles", { exact: true })).toBeVisible();

  await page.getByLabel("Search").fill("roundtable");
  await expect(page.getByRole("link", { name: "Community roundtable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Opening strategy keynote" })).toBeHidden();
  await page.getByLabel("Search").fill("");

  await page.getByRole("combobox", { name: "Room" }).click();
  await page.getByRole("option", { name: "Design Studio" }).click();
  await expect(page.getByRole("link", { name: "Community roundtable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Daylight saving design lab" })).toBeHidden();
  await page.getByRole("combobox", { name: "Room" }).click();
  await page.getByRole("option", { name: "All rooms" }).click();

  await page.getByRole("combobox", { name: "Track" }).click();
  await page.getByRole("option", { name: "Strategy" }).click();
  await expect(page.getByRole("link", { name: "Opening strategy keynote" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Community roundtable" })).toBeHidden();
  await page.getByRole("combobox", { name: "Track" }).click();
  await page.getByRole("option", { name: "All tracks" }).click();

  await page.getByRole("combobox", { name: "Day" }).click();
  await page.getByRole("option", { name: "Sunday, March 14, 2027" }).click();
  await expect(page.getByRole("link", { name: "Daylight saving design lab" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Opening strategy keynote" })).toBeHidden();
  await page.getByRole("combobox", { name: "Day" }).click();
  await page.getByRole("option", { name: "All days" }).click();

  await page.getByLabel("Search").fill("no such session");
  await expect(page.getByText("No sessions match")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("link", { name: "Opening strategy keynote" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#session-${sessionId}$`));

  await page.getByRole("radio", { name: "Dark theme" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-embed-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  runFixture("republish");
  await page.reload();
  await expect(page.getByRole("link", { name: "Republished strategy keynote" })).toBeVisible();

  await page.setContent(`
    <style>* { color: rgb(255, 0, 0) !important; font-size: 40px !important; }</style>
    <iframe title="Agenda host isolation" src="${new URL(embedPath, baseURL)}"></iframe>
  `);
  const isolated = page.frameLocator('iframe[title="Agenda host isolation"]');
  await expect(isolated.getByRole("heading", { name: "Pacific Tabletop Summit" })).toBeVisible();
  expect(await isolated.locator("main").evaluate((element) => getComputedStyle(element).color)).not.toBe(
    "rgb(255, 0, 0)",
  );

  runFixture("unpublish");
  await page.goto(embedPath);
  await expect(page.getByText("Agenda unavailable")).toBeVisible();
  await expect(page.getByText("The organizer has taken this agenda offline.")).toBeVisible();
});
