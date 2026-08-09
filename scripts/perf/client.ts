import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { withQueryInstrumentation } from "../../src/server/observability/prisma-instrumentation.ts";

/**
 * The performance scripts cannot use `src/server/database/client.ts`: it is
 * `server-only`, which throws outside a Next.js server bundle. They build the
 * same instrumented client the application builds, the same way the
 * `*.integration.ts` suites do.
 *
 * `DATABASE_URL` is supplied by `scripts/run-test-database-command.mjs`, so
 * these scripts read and write the test database and never production.
 */
export function createBenchmarkClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the performance benchmark.");
  return withQueryInstrumentation(new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) }));
}
