import "dotenv/config";

import { defineConfig } from "prisma/config";

const localDatabaseUrl = "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? localDatabaseUrl,
  },
});
