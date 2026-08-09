import type { PrismaClient } from "@/generated/prisma/client";

import { recordQuery } from "./query-metrics.ts";

/**
 * Counts and times every database round trip against the active
 * `withQueryMetrics` scope.
 *
 * The extension only ever reads `model` and `operation` — never `args` — so an
 * instrumented client cannot leak a query argument into a metric. Outside a
 * scope `recordQuery` is a no-op, which is the normal case in production.
 *
 * `$extends` widens the client type beyond `PrismaClient`, and every repository
 * here is typed against `PrismaClient`. The extension adds no fields and removes
 * none, so the cast is sound; it exists to keep the repository signatures from
 * having to name an extended-client type.
 */
export function withQueryInstrumentation(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const startedAt = performance.now();
        try {
          return await query(args);
        } finally {
          recordQuery(`${model ?? "$raw"}.${operation}`, performance.now() - startedAt);
        }
      },
    },
  }) as unknown as PrismaClient;
}
