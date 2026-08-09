import { BENCHMARK_PROFILE, createBenchmarkFixtures } from "../../src/server/database/benchmark-fixtures.ts";
import { PublishedProgramRepository } from "../../src/server/published-program/repositories.ts";
import { createBenchmarkClient } from "./client.ts";

const BENCHMARK_ACTOR_ID = "20090000-0000-4000-8000-000000000003";

const client = createBenchmarkClient();

try {
  const startedAt = performance.now();
  const seeded = await createBenchmarkFixtures(client);
  // The embeds surface reads a published snapshot, so publish through the real
  // repository rather than hand-writing snapshot JSON that would drift from it.
  await new PublishedProgramRepository(client).publish({
    eventId: seeded.eventId,
    expectedVersion: 0,
    actorPrincipalId: BENCHMARK_ACTOR_ID,
  });
  const seconds = ((performance.now() - startedAt) / 1_000).toFixed(1);

  process.stdout.write(
    `Seeded ${seeded.eventSlug} in ${seconds}s: ` +
      `${seeded.counts.submissions} submissions, ${seeded.counts.speakers} speakers, ` +
      `${seeded.counts.sessions} scheduled sessions.\n` +
      `Event ${seeded.eventId}, CFP public id ${seeded.cfpPublicId}, ` +
      `${BENCHMARK_PROFILE.rooms} rooms over ${BENCHMARK_PROFILE.days} days.\n`,
  );
} finally {
  await client.$disconnect();
}
