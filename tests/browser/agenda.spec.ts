import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: testDatabaseUrl });
let webhook: Server;
let resolveMagicLink: ((url: string) => void) | undefined;

function nextMagicLink(): Promise<string> {
  return new Promise((resolve) => {
    resolveMagicLink = resolve;
  });
}

test.beforeAll(async () => {
  webhook = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { text?: string };
      const link = body.text?.match(/https?:\/\/\S+/)?.[0];
      if (link) resolveMagicLink?.(link);
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    webhook.once("error", reject);
    webhook.listen(3199, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    webhook.close((error) => (error ? reject(error) : resolve()));
  });
  await database.end();
});

test("creates, filters, edits, confirms conflicts, persists, and removes agenda placements", async ({
  context,
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const event = { id: randomUUID(), slug: `browser-agenda-${suffix}` };
  const roomId = randomUUID();
  const trackId = randomUUID();
  const firstSessionId = randomUUID();
  const firstVersionId = randomUUID();
  const secondSessionId = randomUUID();
  const secondVersionId = randomUUID();
  const now = new Date();
  const seedConnection = await database.connect();
  await seedConnection.query("BEGIN");
  try {
    await seedConnection.query(
      `INSERT INTO "events" ("id", "name", "slug", "type", "timezone", "startsAt", "endsAt", "updatedAt")
       VALUES ($1, 'Browser agenda event', $2, 'CONFERENCE', 'America/Los_Angeles', $3, $4, $5)`,
      [event.id, event.slug, new Date("2027-03-13T17:00:00.000Z"), new Date("2027-03-14T00:00:00.000Z"), now],
    );
    await seedConnection.query(
      `INSERT INTO "rooms" ("id", "eventId", "name", "sortOrder", "updatedAt")
       VALUES ($1, $2, 'Main Hall', 0, $3)`,
      [roomId, event.id, now],
    );
    await seedConnection.query(
      `INSERT INTO "tracks" ("id", "eventId", "name", "color", "sortOrder", "updatedAt")
       VALUES ($1, $2, 'Game design', 'blue', 0, $3)`,
      [trackId, event.id, now],
    );
    await seedConnection.query(
      `INSERT INTO "program_sessions" ("id", "eventId", "kind", "updatedAt")
       VALUES ($1, $2, 'MANUAL', $4), ($3, $2, 'MANUAL', $4)`,
      [firstSessionId, event.id, secondSessionId, now],
    );
    await seedConnection.query(
      `INSERT INTO "program_session_versions"
         ("id", "eventId", "sessionId", "versionNumber", "title", "durationMinutes", "trackId")
       VALUES ($1, $2, $3, 1, 'Opening keynote', 45, $4),
              ($5, $2, $6, 1, 'Cooperative tension lab', 60, $4)`,
      [firstVersionId, event.id, firstSessionId, trackId, secondVersionId, secondSessionId],
    );
    await seedConnection.query("COMMIT");
  } catch (error) {
    await seedConnection.query("ROLLBACK");
    throw error;
  } finally {
    seedConnection.release();
  }

  try {
    const deliveredLink = nextMagicLink();
    await page.goto("/auth/v1/login");
    await page.getByRole("textbox", { name: "Email address" }).fill("admin@example.test");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.goto(await deliveredLink);
    await context.addCookies([
      {
        name: "board_to_death_active_event",
        value: event.id,
        domain: "127.0.0.1",
        path: "/dashboard",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto(`/dashboard/events/${event.slug}/agenda`);
    await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
    await page.getByRole("radio", { name: "Unscheduled" }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByText("2 sessions")).toBeVisible();

    await page.getByRole("button", { name: "Schedule Opening keynote" }).click();
    await page.getByLabel("Starts at").fill("2027-03-13T10:00");
    await page.getByRole("button", { name: "Add to agenda" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Session added to the agenda.")).toBeVisible();

    await page.reload();
    await page.getByRole("radio", { name: "Scheduled" }).click();
    await expect(page.getByText("Opening keynote")).toBeVisible();
    await expect(page.getByText("Cooperative tension lab")).toHaveCount(0);

    await page.getByRole("radio", { name: "Unscheduled" }).click();
    await page.getByRole("button", { name: "Schedule Cooperative tension lab" }).click();
    await page.getByLabel("Starts at").fill("2027-03-13T10:15");
    await page.getByRole("button", { name: "Add to agenda" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Resolve these conflicts" })).toContainText(
      "Main Hall overlaps with Opening keynote",
    );

    await page.getByRole("radio", { name: "Allow after confirmation" }).click();
    await page.getByRole("button", { name: "Add to agenda" }).click();
    const conflictDialog = page.getByRole("alertdialog");
    await expect(conflictDialog).toContainText("Save with 2 agenda conflicts?");
    await conflictDialog.getByRole("button", { name: "Confirm and save" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Session added to the agenda.")).toBeVisible();

    await page.reload();
    await page.getByRole("radio", { name: "Scheduled" }).click();
    await page.getByRole("button", { name: "Edit placement for Cooperative tension lab" }).click();
    await expect(page.getByLabel("Starts at")).toHaveValue("2027-03-13T10:15");
    await page.getByLabel("Starts at").fill("2027-03-13T12:00");
    await page.getByRole("button", { name: "Save placement" }).click();
    await expect(page.getByText("Agenda placement saved.")).toBeVisible();

    await page.reload();
    await page.getByRole("radio", { name: "Scheduled" }).click();
    await page.getByRole("button", { name: "Edit placement for Cooperative tension lab" }).click();
    await expect(page.getByLabel("Starts at")).toHaveValue("2027-03-13T12:00");
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove placement" }).click();
    await expect(page.getByText("Session removed from the agenda.")).toBeVisible();
  } finally {
    await database.query(`DELETE FROM "events" WHERE "id" = $1`, [event.id]);
  }
});
