import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const runFile = promisify(execFile);
let eventSlug = "";
let eventId = "";
let formId = "";
let sessionToken = "";

async function fixture(...arguments_: string[]): Promise<string> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/helpers/cfp-setup-fixture.ts", ...arguments_],
    { env: { ...process.env, TEST_DATABASE_URL: databaseUrl } },
  );
  return stdout.trim();
}

test.describe("CFP setup", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const setup = JSON.parse(await fixture("setup", baseURL)) as {
      eventId: string;
      eventSlug: string;
      formId: string;
      sessionToken: string;
    };
    eventId = setup.eventId;
    eventSlug = setup.eventSlug;
    formId = setup.formId;
    sessionToken = setup.sessionToken;
  });

  test.afterAll(async () => {
    await fixture("cleanup", eventSlug);
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: sessionToken,
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "board_to_death_active_event",
        value: eventId,
        url: baseURL,
        sameSite: "Lax",
      },
    ]);
  });

  test("validates, saves, navigates, and restores every setup step", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/dashboard/events/${eventSlug}/cfp/forms/${formId}/setup`);

    await expect(page.getByRole("heading", { name: "Untitled CFP" })).toBeVisible();
    const title = page.getByRole("textbox", { name: "Form name" });
    await title.fill("x");
    await page.getByRole("button", { name: "Save and continue" }).click();
    expect(await title.evaluate((input) => input.matches(":invalid"))).toBe(true);

    await title.fill("Board Games 2028 CFP");
    await page.getByRole("radio", { name: "Guaranteed session" }).click();
    await page.getByRole("radio", { name: "Restricted" }).click();
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(page.getByText("Speaker requirements", { exact: true })).toBeVisible();
    await page.getByRole("spinbutton", { name: "Minimum speakers" }).fill("3");
    await page.getByRole("spinbutton", { name: "Maximum speakers" }).fill("2");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByText("Maximum speakers must be greater than or equal to minimum speakers.")).toBeVisible();
    await page.getByRole("spinbutton", { name: "Maximum speakers" }).fill("4");
    await page.getByRole("switch", { name: "Biography" }).click();
    await page.getByRole("switch", { name: "Contact details" }).click();
    await page.getByRole("switch", { name: "Consent" }).click();
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(page.getByText("Welcome and instructions", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Welcome heading" }).fill("Bring your best tabletop idea");
    await page
      .getByRole("textbox", { name: "Welcome message" })
      .fill("We are looking for practical sessions that help tabletop creators build memorable games.");
    await page
      .getByRole("textbox", { name: "Submission instructions" })
      .fill("Describe the audience, format, and three concrete takeaways for your proposed session.");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(page.getByText("Terms and consent", { exact: true })).toBeVisible();
    await page.getByRole("switch", { name: "Require explicit consent" }).click();
    const terms = page.getByRole("textbox", { name: "Terms or consent statement" });
    await page.getByRole("button", { name: "Save terms" }).click();
    expect(await terms.evaluate((input) => input.matches(":invalid"))).toBe(true);
    await terms.fill("I agree that accepted sessions may be recorded and published by the event.");
    await page.getByRole("button", { name: "Save terms" }).click();
    await expect(page.getByText("Changes saved as a new draft version.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Form name" })).toHaveValue("Board Games 2028 CFP");
    await expect(page.getByRole("radio", { name: "Guaranteed session" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Restricted" })).toBeChecked();
    await page.getByRole("tab", { name: "Speakers" }).click();
    await expect(page.getByRole("spinbutton", { name: "Minimum speakers" })).toHaveValue("3");
    await expect(page.getByRole("spinbutton", { name: "Maximum speakers" })).toHaveValue("4");
    await expect(page.getByRole("switch", { name: "Biography" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Contact details" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Consent" })).toBeChecked();
    await page.getByRole("tab", { name: "Welcome" }).click();
    await expect(page.getByRole("textbox", { name: "Welcome heading" })).toHaveValue("Bring your best tabletop idea");
    await page.getByRole("tab", { name: "Terms" }).click();
    await expect(page.getByRole("switch", { name: "Require explicit consent" })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Terms or consent statement" })).toHaveValue(
      "I agree that accepted sessions may be recorded and published by the event.",
    );
  });

  test("does not expose a form through a different event slug", async ({ page }) => {
    await page.goto(`/dashboard/events/not-${eventSlug}/cfp/forms/${formId}/setup`);
    await expect(page.getByRole("heading", { name: "Page not found." })).toBeVisible();
  });

  test("assigns and removes an event administrator with independent alert preferences", async ({ page }) => {
    await page.goto(`/dashboard/events/${eventSlug}/cfp/forms/${formId}/setup`);
    await page.getByRole("tab", { name: "Administrators" }).click();

    const owner = page.getByRole("checkbox", { name: /CFP Owner/ });
    const editor = page.getByRole("checkbox", { name: /Program Editor/ });
    await expect(owner).toBeChecked();
    await expect(owner).toBeDisabled();
    await editor.check();

    await page.getByRole("switch", { name: "New submissions" }).nth(1).check();
    await page.getByRole("switch", { name: "Submission updates" }).nth(1).check();
    await page.getByRole("button", { name: "Save administrators" }).click();
    await expect(page.getByText("Administrator assignments and alert preferences saved.")).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: "Administrators" }).click();
    await expect(page.getByRole("checkbox", { name: /Program Editor/ })).toBeChecked();
    await expect(page.getByRole("switch", { name: "New submissions" }).nth(1)).toBeChecked();
    await expect(page.getByRole("switch", { name: "Submission updates" }).nth(1)).toBeChecked();

    await page.getByRole("checkbox", { name: /Program Editor/ }).uncheck();
    await Promise.all([
      page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().includes(`/cfp/forms/${formId}/setup`),
      ),
      page.getByRole("button", { name: "Save administrators" }).click(),
    ]);
    await page.reload();
    await page.getByRole("tab", { name: "Administrators" }).click();
    await expect(page.getByRole("checkbox", { name: /Program Editor/ })).not.toBeChecked();
    await expect(page.getByRole("switch", { name: "New submissions" }).nth(1)).toBeDisabled();
    await expect(page.getByText("Submitter confirmation stays mandatory")).toBeVisible();
  });
});
