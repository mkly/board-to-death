import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? "npm run dev -- --hostname 127.0.0.1 --port 3100";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "test-results",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AUTH_SECRET: process.env.AUTH_SECRET ?? "quality-gate-auth-secret-at-least-32-characters",
      DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "quality-gate-better-auth-secret-at-least-32-characters",
      BETTER_AUTH_URL: baseURL,
      AUTH_ALLOWED_EMAILS: process.env.AUTH_ALLOWED_EMAILS ?? "admin@example.test",
      AUTH_MAGIC_LINK_WEBHOOK_URL: process.env.AUTH_MAGIC_LINK_WEBHOOK_URL ?? "http://127.0.0.1:3199",
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
