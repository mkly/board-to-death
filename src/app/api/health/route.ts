import { getRuntimeConfig } from "@/config/runtime-env.server";
import { getDatabaseClient } from "@/server/database";
import { checkReadiness, createReadinessResponse } from "@/server/runtime/readiness";

import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = getRuntimeConfig();
  const result = await checkReadiness({
    database: async () => {
      await getDatabaseClient().$queryRaw`SELECT 1`;
    },
    storage: async () => {
      // Serverless hosts (Vercel) hand each instance an empty /tmp, so the
      // storage root only exists if this instance created it. Creating it here
      // keeps the readiness probe honest — it still fails when the path is
      // genuinely unwritable — instead of reporting a cold start as unhealthy.
      await mkdir(config.server.FILE_STORAGE_PATH, { recursive: true, mode: 0o700 });
      await access(config.server.FILE_STORAGE_PATH, constants.R_OK | constants.W_OK);
    },
  });

  return createReadinessResponse(result);
}
