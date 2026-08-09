/**
 * Hard caps and cursor helpers for the list reads that back dashboard screens.
 *
 * A `findMany` with no `take` costs whatever the table holds, so a screen that
 * was fast at the demo fixture's single session degrades linearly against the
 * benchmarked profile. Every list read here takes a bounded page; a caller that
 * genuinely needs the whole set walks pages instead, so the per-query cost stays
 * flat even when the total does not.
 *
 * The caps sit above the benchmarked profile in `performance/budgets.json`, so
 * they change nothing at that size and only engage past it.
 */
export const LIST_BOUNDS = {
  /** Program sessions rendered by the admin sessions and agenda screens. */
  programSessions: 1_000,
  /** Agenda placements rendered by the agenda calendar. */
  agendaPlacements: 1_000,
  /** Speakers resolved for session and placement labels. */
  speakers: 2_000,
  /** Sessions a single speaker participates in, on the portal dashboard. */
  speakerPortalSessions: 200,
} as const;

/** Rows read per query when a caller walks the whole set. */
export const CHUNK_SIZE = 500;

export interface ListPage<T> {
  readonly items: readonly T[];
  /** Cursor for the next page, or `null` when this page is the last one. */
  readonly nextCursor: string | null;
  /** `true` when more rows exist past this page. */
  readonly hasMore: boolean;
}

/** Clamps a caller-supplied limit into `[1, cap]`, defaulting to the cap. */
export function boundedLimit(limit: number | undefined, cap: number): number {
  if (limit === undefined) return cap;
  return Math.min(cap, Math.max(1, Math.trunc(limit)));
}

/**
 * Splits an over-read into a page. Callers fetch `limit + 1` rows; the extra row
 * is the existence proof for `hasMore` and never reaches the caller.
 */
export function toListPage<T>(rows: readonly T[], limit: number, cursorOf: (row: T) => string): ListPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items.at(-1);
  return { items, hasMore, nextCursor: hasMore && last ? cursorOf(last) : null };
}

/**
 * Walks every page of a bounded read. The total row count still costs what it
 * costs, but each round trip is capped, which is the property export routes need
 * and interactive screens must not rely on.
 */
export async function collectPages<T>(
  readPage: (cursor: string | null, take: number) => Promise<ListPage<T>>,
  chunkSize: number = CHUNK_SIZE,
): Promise<T[]> {
  const collected: T[] = [];
  let cursor: string | null = null;

  for (;;) {
    const page: ListPage<T> = await readPage(cursor, chunkSize);
    collected.push(...page.items);
    if (!page.hasMore || page.nextCursor === null) return collected;
    cursor = page.nextCursor;
  }
}
