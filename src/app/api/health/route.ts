import { getRuntimeConfig } from "@/config/runtime-env.server";
import { getDatabaseClient } from "@/server/database";
import { checkReadiness, createReadinessResponse } from "@/server/runtime/readiness";

import { constants } from "node:fs";
import { access } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = getRuntimeConfig();
  const result = await checkReadiness({
    database: async () => {
      await getDatabaseClient().$queryRaw`SELECT 1`;
    },
    storage: async () => {
      await access(config.server.FILE_STORAGE_PATH, constants.R_OK | constants.W_OK);
    },
  });

  return createReadinessResponse(result);
}
