import { Client } from "pg";

import { getTestDatabaseUrl, recreatePublicSchema } from "./test-database.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";

const testDatabaseUrl = getTestDatabaseUrl();
const migrationEntries = await readdir(new URL("../prisma/migrations", import.meta.url), { withFileTypes: true });
const expectedMigrations = migrationEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

await recreatePublicSchema(testDatabaseUrl);
await runPackageScript("db:test:deploy");

const client = new Client({ connectionString: testDatabaseUrl });
await client.connect();

try {
  const migrationResult = await client.query(`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    ORDER BY started_at
  `);

  assert.deepEqual(
    migrationResult.rows.map(({ migration_name: migrationName }) => migrationName),
    expectedMigrations,
  );
  assert.ok(migrationResult.rows.every(({ finished_at: finishedAt }) => finishedAt instanceof Date));
  assert.ok(migrationResult.rows.every(({ rolled_back_at: rolledBackAt }) => rolledBackAt === null));
} finally {
  await client.end();
}

await runPackageScript("db:status", { DATABASE_URL: testDatabaseUrl });
console.log("Migration smoke test passed: all migrations applied cleanly from an empty PostgreSQL schema.");

function runPackageScript(scriptName, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--run", scriptName], {
      env: {
        ...process.env,
        ...environment,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${scriptName} terminated with signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${scriptName} exited with code ${code}`));
        return;
      }

      resolve();
    });
  });
}
