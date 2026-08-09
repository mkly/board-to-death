import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("redirects an unauthenticated administrator to the login screen", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/auth\/v1\/login\?returnTo=%2Fdashboard$/);
  await expect(page.getByRole("heading", { name: "Hello again" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email address" })).toBeVisible();
});

test("reports invalid email input without calling the authentication API", async ({ page }) => {
  await page.goto("/auth/v1/login");
  await page.getByRole("textbox", { name: "Email address" }).fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
});

test("has no automatically detectable WCAG A or AA violations on the login screen", async ({ page }) => {
  await page.goto("/auth/v1/login");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
