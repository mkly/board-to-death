export interface ReadinessDependencies {
  readonly database: () => Promise<void>;
  readonly storage: () => Promise<void>;
}

export type ReadinessResult =
  | { readonly ready: true }
  | { readonly ready: false; readonly failedChecks: readonly ("database" | "storage")[] };

export async function checkReadiness(dependencies: ReadinessDependencies): Promise<ReadinessResult> {
  const checks = await Promise.allSettled([dependencies.database(), dependencies.storage()]);
  const failedChecks: ("database" | "storage")[] = [];

  if (checks[0].status === "rejected") failedChecks.push("database");
  if (checks[1].status === "rejected") failedChecks.push("storage");

  return failedChecks.length === 0 ? { ready: true } : { ready: false, failedChecks };
}

export function createReadinessResponse(result: ReadinessResult): Response {
  return Response.json(
    result.ready
      ? { status: "ready", checks: { database: "up", storage: "up" } }
      : {
          status: "unavailable",
          checks: {
            database: result.failedChecks.includes("database") ? "down" : "up",
            storage: result.failedChecks.includes("storage") ? "down" : "up",
          },
        },
    {
      status: result.ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
