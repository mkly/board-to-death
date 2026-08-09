import { AgendaPlacementRepository, validateAgendaConflicts } from "../../src/server/agenda/index.ts";
import { CfpPublicAccessRepository } from "../../src/server/cfp/public-access.ts";
import { CfpSubmissionRepository } from "../../src/server/cfp/submissions.ts";
import { BENCHMARK_PROFILE } from "../../src/server/database/benchmark-fixtures.ts";
import {
  compareToBudgets,
  formatBudgetReport,
  type PerformanceBudgets,
  type SurfaceMeasurement,
} from "../../src/server/observability/budgets.ts";
import { withQueryMetrics } from "../../src/server/observability/query-metrics.ts";
import { handlePublicProgramRequest } from "../../src/server/published-program/public-api.ts";
import { PublishedProgramRepository } from "../../src/server/published-program/repositories.ts";
import { ProgramSessionRepository } from "../../src/server/sessions/repositories.ts";
import { SpeakerPortalRepository } from "../../src/server/speaker-portal/dashboard.ts";
import { SpeakerRepository } from "../../src/server/speakers/repositories.ts";
import { createBenchmarkClient } from "./client.ts";
import { readFile, writeFile } from "node:fs/promises";

const BUDGETS_PATH = "performance/budgets.json";
const ARTIFACT_PATH = process.env.PERF_ARTIFACT_PATH ?? "performance/latest-run.json";

const client = createBenchmarkClient();

async function measure(surface: string, run: () => Promise<{ readonly responseBytes?: number }>) {
  const { result, metrics, totalDurationMs } = await withQueryMetrics(async () => run());
  return {
    surface,
    queryCount: metrics.queryCount,
    databaseDurationMs: metrics.databaseDurationMs,
    totalDurationMs,
    operations: metrics.operations,
    ...(typeof result.responseBytes === "number" ? { responseBytes: result.responseBytes } : {}),
  } satisfies SurfaceMeasurement;
}

try {
  const event = await client.event.findUnique({
    where: { slug: BENCHMARK_PROFILE.eventSlug },
    select: { id: true, slug: true, startsAt: true, endsAt: true, timezone: true },
  });
  if (!event) throw new Error(`Seed the benchmark profile first: npm run perf:seed (${BENCHMARK_PROFILE.eventSlug}).`);

  const [policy, speaker] = await Promise.all([
    client.cfpPolicy.findFirstOrThrow({ where: { eventId: event.id }, select: { publicId: true } }),
    client.speaker.findFirstOrThrow({ where: { eventId: event.id }, select: { id: true } }),
  ]);

  const measurements: SurfaceMeasurement[] = [];

  // The admin table's first page, which is what an administrator actually waits
  // on. Its cost must not track the 10000 submissions behind it.
  measurements.push(
    await measure("admin-submission-table", async () => {
      await new CfpSubmissionRepository(client).listForEvent(event.id, { page: 1, pageSize: 25 });
      return {};
    }),
  );

  measurements.push(
    await measure("public-cfp", async () => {
      await new CfpPublicAccessRepository(client).findByPublicId(policy.publicId);
      return {};
    }),
  );

  measurements.push(
    await measure("speaker-portal-dashboard", async () => {
      await new SpeakerPortalRepository(client).getDashboard({ eventId: event.id, speakerId: speaker.id });
      return {};
    }),
  );

  // The agenda screen's server render, reproduced read for read.
  measurements.push(
    await measure("agenda", async () => {
      const [sessionPage, placementPage] = await Promise.all([
        new ProgramSessionRepository(client).listPage(event.id),
        new AgendaPlacementRepository(client).listPage(event.id),
        client.room.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
        client.track.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
        new SpeakerRepository(client).listPage(event.id),
      ]);
      validateAgendaConflicts(
        { startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone },
        placementPage.items,
      );
      if (sessionPage.items.length === 0) throw new Error("The benchmark event has no sessions.");
      return {};
    }),
  );

  // Embeds go through the public HTTP handler, so the response body is the real
  // payload a third-party site downloads.
  measurements.push(
    await measure("embeds", async () => {
      const response = await handlePublicProgramRequest(
        new Request(`https://benchmark.test/api/public/events/${event.slug}/sessions?page=1&pageSize=50`),
        event.slug,
        "sessions",
        new PublishedProgramRepository(client),
      );
      if (!response.ok) throw new Error(`The embeds surface returned ${response.status}.`);
      return { responseBytes: new TextEncoder().encode(await response.text()).byteLength };
    }),
  );

  const budgets = JSON.parse(await readFile(BUDGETS_PATH, "utf8")) as PerformanceBudgets;
  const comparison = compareToBudgets(budgets, measurements);

  await writeFile(
    ARTIFACT_PATH,
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        budgetsVersion: budgets.version,
        profile: budgets.profile,
        measurements,
        violations: comparison.violations,
        unmeasured: comparison.unmeasured,
        unbudgeted: comparison.unbudgeted,
        passed: comparison.passed,
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(`Performance budgets (${BENCHMARK_PROFILE.eventSlug}):\n`);
  process.stdout.write(`${formatBudgetReport(comparison, measurements)}\n`);
  process.stdout.write(`Wrote ${ARTIFACT_PATH}\n`);

  if (!comparison.passed) {
    process.stdout.write("Performance budgets exceeded.\n");
    process.exitCode = 1;
  }
} finally {
  await client.$disconnect();
}
