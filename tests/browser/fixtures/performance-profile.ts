import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { BENCHMARK_PROFILE, createBenchmarkFixtures } from "../../../src/server/database/benchmark-fixtures.ts";
import { PublishedProgramRepository } from "../../../src/server/published-program/repositories.ts";

/**
 * Ensures the fixed benchmark profile exists before the browser performance
 * spec measures against it. Seeding is expensive, so an already-seeded profile
 * is reused: `npm run perf:seed` and this fixture produce the same event.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) {
  throw new Error("The performance browser fixture requires a guarded *_test database.");
}

const BENCHMARK_ACTOR_ID = "20090000-0000-4000-8000-000000000003";

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const existing = await database.event.findUnique({
    where: { slug: BENCHMARK_PROFILE.eventSlug },
    select: { id: true, publishedProgram: { select: { id: true } } },
  });

  if (existing?.publishedProgram) {
    process.stdout.write(`${JSON.stringify({ eventSlug: BENCHMARK_PROFILE.eventSlug, seeded: false })}\n`);
  } else {
    const seeded = await createBenchmarkFixtures(database);
    await new PublishedProgramRepository(database).publish({
      eventId: seeded.eventId,
      expectedVersion: 0,
      actorPrincipalId: BENCHMARK_ACTOR_ID,
    });
    process.stdout.write(`${JSON.stringify({ eventSlug: seeded.eventSlug, seeded: true })}\n`);
  }
} finally {
  await database.$disconnect();
}
