# Performance budgets

The five surfaces that carry the most rows — the admin submission table, the
public CFP, the speaker portal dashboard, the agenda, and the public embeds —
are measured against committed numeric budgets. A change that makes one of them
read more rows, issue more queries, or return a larger payload fails CI instead
of arriving in production as a slow page.

## The fixed profile

Everything is measured against one deterministic seed,
`src/server/database/benchmark-fixtures.ts`:

| Quantity | Count |
| --- | --- |
| Speakers (and speaker profile versions) | 1,000 |
| CFP submissions (each with a revision, two answers, a participant, a category) | 10,000 |
| Program sessions, scheduled into agenda placements | 500 |
| Rooms / tracks | 20 / 20 |
| Speaker task assignments | 1,000 |
| Speaker resource pages | 8 |

Every identifier is derived from a namespaced UUID pattern rather than random,
so two seeds of the same profile produce identical rows and a measurement is
comparable across machines and runs. Submission files (`slidesObjectKey`, and a
supporting document on every third participant) are populated so the admin table
measures the joins a real event has.

The event slug is `board-to-death-benchmark`. Seeding deletes and recreates it,
so a re-seed is safe and idempotent.

## Running it locally

```sh
npm run db:test:reset   # only when the schema moved
npm run perf:seed       # ~1 minute; writes the fixed profile to TEST_DATABASE_URL
npm run perf:bench      # measures every surface and compares against the budgets
```

Both commands route through `scripts/run-test-database-command.mjs`, so they
only ever touch the `*_test` database — never the development one, and never
production. `TEST_DATABASE_URL` comes from `.env`; in a fresh box it is not set
and must be exported first (see `CLAUDE.md`).

`perf:bench` writes `performance/latest-run.json` (override the path with
`PERF_ARTIFACT_PATH`) and exits non-zero when any budget is exceeded.

The production-browser half runs through Playwright:

```sh
npx playwright test tests/browser/performance-budgets.spec.ts
```

It seeds the profile only when it is missing, then reads each public program
route's `Server-Timing` header and asserts the query count, database time, app
time, and response size against the same committed budgets. It also asserts that
page 8 of 500 sessions costs exactly as many queries as page 1 — the regression
the whole profile exists to catch.

## The budget file

`performance/budgets.json` is the source of truth:

```json
{
  "version": 1,
  "profile": { "eventSlug": "board-to-death-benchmark", "speakers": 1000, "submissions": 10000, "sessions": 500 },
  "surfaces": {
    "agenda": { "maxQueries": 6, "maxDatabaseDurationMs": 4000, "maxTotalDurationMs": 6000 }
  }
}
```

The committed numbers come from a measured run of the profile, with the query
counts set one above what the surface actually issues and the durations and
byte ceilings set well above it:

| Surface | Measured | Budget (queries / db ms / total ms) |
| --- | --- | --- |
| `admin-submission-table` | 3 queries, 116 ms db, 119 ms total | 4 / 1500 / 3000 |
| `public-cfp` | 1 query, 10 ms db, 20 ms total | 2 / 750 / 1500 |
| `speaker-portal-dashboard` | 5 queries, 123 ms db, 42 ms total | 6 / 1500 / 3000 |
| `agenda` | 5 queries, 655 ms db, 261 ms total | 6 / 4000 / 6000 |
| `embeds` | 1 query, 27 ms db, 86 ms total, 16.0 KiB | 3 / 1500 / 3000, 256 KiB |

The `embeds` surface is the public program HTTP handler, so its budget is also
what the browser spec holds the `sessions`, `speakers`, and `agenda` routes to —
they are the same handler, and an embed is what downloads them.

`maxQueries` is the load-bearing number. It is machine-independent, and it is
what actually catches an N+1 or a read that quietly lost its bound. The duration
and byte ceilings are set with headroom so a slow CI runner cannot fail a build
on its own.

`compareToBudgets` in `src/server/observability/budgets.ts` fails a run when a
budgeted surface is **not measured** as well as when it is over budget: a
benchmark that silently stops measuring a surface would otherwise report a clean
run forever. A measured surface with no budget is reported but does not fail —
that is how a new surface gets added.

### Changing a budget

Raising a budget is a reviewable decision, not a fix for a red build. Raise one
only with the reason in the commit message, and bump `version` when the profile
itself changes so old artifacts are not compared against new numbers.

## What the instrumentation records

`src/server/observability/query-metrics.ts` holds request-scoped counters in an
`AsyncLocalStorage` scope, and `prisma-instrumentation.ts` feeds it from a Prisma
`$allOperations` extension, so every query the application issues is counted
wherever it is issued from.

Only three things are ever recorded: a count, a duration, and the Prisma
`model.operation` pair. Query arguments, selected rows, event identifiers, and
speaker data are never touched. Anything that does not match the
`model.operation` shape collapses to `unknown` rather than being passed through,
so a caller cannot smuggle data into an artifact that is committed to the
repository and uploaded from CI. `query-metrics.test.ts` holds that line, and
the browser spec asserts the emitted header matches
`app;dur=…, db;dur=…;desc="queries=N"` exactly and contains no event slug.

The same numbers are emitted as a `Server-Timing` header on the public program
routes, which is why the browser can read them.

## Keeping reads bounded

`src/server/database/list-bounds.ts` declares the per-surface caps and the
cursor-paginated `listPage` / `collectPages` helpers the session, placement, and
speaker repositories use. A list read takes `limit + 1` rows and reports whether
more exist rather than returning an unbounded `findMany`; the agenda and sessions
screens render a truncation notice when they hit the cap. Add new high-volume
reads through those helpers so their cost stays flat as an event grows.
