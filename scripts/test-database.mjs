import "dotenv/config";

import { Client } from "pg";

const requiredDatabaseSuffix = "_test";

export function getTestDatabaseUrl(environment = process.env) {
  const testDatabaseUrl = environment.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for test database commands");
  }

  const parsedTestUrl = new URL(testDatabaseUrl);
  const testDatabaseName = decodeURIComponent(parsedTestUrl.pathname.slice(1));

  if (!testDatabaseName.endsWith(requiredDatabaseSuffix)) {
    throw new Error(
      `Refusing to modify database "${testDatabaseName}": its name must end in ${requiredDatabaseSuffix}`,
    );
  }

  if (environment.DATABASE_URL && databaseIdentity(environment.DATABASE_URL) === databaseIdentity(testDatabaseUrl)) {
    throw new Error("DATABASE_URL and TEST_DATABASE_URL must identify different databases");
  }

  return testDatabaseUrl;
}

export async function recreatePublicSchema(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('DROP SCHEMA IF EXISTS "public" CASCADE');
    await client.query('CREATE SCHEMA "public"');
  } finally {
    await client.end();
  }
}

function databaseIdentity(databaseUrl) {
  const parsedUrl = new URL(databaseUrl);
  return `${parsedUrl.protocol}//${parsedUrl.username}@${parsedUrl.hostname}:${parsedUrl.port}${parsedUrl.pathname}`;
}
