import { type BrowserContext, expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers/hydration.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface ContactCustomFieldFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly otherEventId: string;
  readonly otherEventSlug: string;
  readonly sessionCookie: string;
}

const supportedFieldTypes = [
  { label: "Browser short text", key: "browser_short_text", type: "Single-line text" },
  { label: "Browser long text", key: "browser_long_text", type: "Long text" },
  { label: "Browser number", key: "browser_number", type: "Number" },
  { label: "Browser date", key: "browser_date", type: "Date" },
  { label: "Browser single select", key: "browser_single_select", type: "Single select", options: "Alpha\nBeta" },
  { label: "Browser multi select", key: "browser_multi_select", type: "Multi select", options: "Gamma\nDelta" },
  { label: "Browser checkbox", key: "browser_checkbox", type: "Checkbox" },
  { label: "Browser URL", key: "browser_url", type: "URL" },
  { label: "Browser file", key: "browser_file", type: "File" },
] as const;

async function prepareFixture(context: BrowserContext): Promise<ContactCustomFieldFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/contact-custom-fields.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as ContactCustomFieldFixture;
  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL },
    { name: "gatherpulse_active_event", value: fixture.eventId, url: baseURL },
  ]);
  return fixture;
}

test("manages custom field definitions and event-scoped record values", async ({ context, page }) => {
  test.setTimeout(180_000);
  const fixture = await prepareFixture(context);

  await page.goto(`/dashboard/events/${fixture.eventSlug}/settings/custom-fields`);
  await expect(page.getByRole("heading", { name: "Custom fields" })).toBeVisible();

  for (const field of supportedFieldTypes) {
    const newFieldForm = page
      .locator("form")
      .filter({ has: page.locator('input[name="entityType"][value="CONTACT"]') });
    const label = newFieldForm.locator('input[name="label"]');
    await label.fill(field.label);
    await newFieldForm.locator('input[name="key"]').fill(field.key);
    await newFieldForm.getByRole("combobox").first().click();
    await page.getByRole("option", { name: field.type, exact: true }).click();
    if ("options" in field) await newFieldForm.locator('textarea[name="options"]').fill(field.options);
    await newFieldForm.getByRole("button", { name: "Add field" }).click();
    await expect(page.locator(`input[name="label"][value="${field.label}"]`)).toBeVisible();
  }

  await page.getByRole("button", { name: "Move Browser file up" }).click();
  await expect(page.getByText("Custom fields reordered.")).toBeVisible();
  await page.reload();
  const orderedLabels = (
    await page
      .locator('input[name="label"]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))
  ).filter(Boolean);
  expect(orderedLabels.slice(-2)).toEqual(["Browser file", "Browser URL"]);

  const dietaryFieldForm = page.locator('input[name="label"][value="Dietary notes"]').locator("xpath=ancestor::form");
  await dietaryFieldForm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Delete Dietary notes?" })).toBeVisible();
  await page.getByRole("button", { name: "Delete field" }).click();
  await expect(dietaryFieldForm.getByText("Remove this field's saved values before deleting it.")).toBeVisible();
  await page.reload();
  await expect(page.locator('input[name="label"][value="Dietary notes"]')).toBeVisible();

  await page.goto(`/dashboard/events/${fixture.eventSlug}/contacts`);

  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
  await expect(page.getByText("Dana Reed", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Dietary notes")).toHaveValue("Vegan");
  await expect(page.getByText("Vegan", { exact: true })).toBeVisible();
  await expect(page.getByText("Private Person")).toHaveCount(0);
  await expect(page.getByText("Never render this")).toHaveCount(0);

  await waitForHydration(page.getByLabel("Dietary notes"));
  await page.getByLabel("Dietary notes").fill("Vegetarian");
  await page.getByLabel("Browser number").fill("42");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact changes saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Dietary notes")).toHaveValue("Vegetarian");
  await expect(page.getByLabel("Browser number")).toHaveValue("42");
  await expect(page.getByText("Vegetarian", { exact: true })).toBeVisible();

  await page.goto(`/dashboard/events/${fixture.eventSlug}/groups`);
  await expect(page.getByRole("heading", { name: "Sponsors and exhibitors" })).toBeVisible();
  const groupForm = page.locator('input[name="name"][value="Tabletop Partners"]').locator("xpath=ancestor::form");
  const boothLocation = groupForm.getByLabel("Booth location");
  await expect(boothLocation).toHaveValue("Hall A");
  await waitForHydration(boothLocation);
  await boothLocation.fill("Hall B");
  await groupForm.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Group updated.")).toBeVisible();
  await page.reload();
  await expect(
    page
      .locator('input[name="name"][value="Tabletop Partners"]')
      .locator("xpath=ancestor::form")
      .getByLabel("Booth location"),
  ).toHaveValue("Hall B");
  await expect(page.getByText("Hall B", { exact: true })).toBeVisible();

  await context.addCookies([{ name: "gatherpulse_active_event", value: fixture.otherEventId, url: baseURL }]);
  await page.goto(`/dashboard/events/${fixture.otherEventSlug}/contacts`);
  await expect(page.getByText("Private Person", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Private notes")).toHaveValue("Never render this");
  await expect(page.getByLabel("Dietary notes")).toHaveCount(0);

  await page.goto(`/dashboard/events/${fixture.otherEventSlug}/settings/custom-fields`);
  await expect(page.locator('input[name="label"][value="Private notes"]')).toBeVisible();
  await expect(page.locator('input[name="label"][value="Browser file"]')).toHaveCount(0);
});
