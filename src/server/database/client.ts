import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

type PrismaGlobal = typeof globalThis & {
  boardToDeathPrisma?: PrismaClient;
};

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL");
  }

  return databaseUrl;
}

// Every serverless instance opens its own pool, so the effective connection
// count is (pool size × concurrent instances) and a normal pool exhausts a
// Postgres server's connection limit under trivial load. One connection per
// instance, released promptly when idle, is the shape that survives; a long
// lived server keeps the driver's own defaults.
const SERVERLESS_POOL: Record<string, number> = {
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
};

export function createDatabaseClient(databaseUrl = requireDatabaseUrl()): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      ...(process.env.VERCEL ? SERVERLESS_POOL : {}),
    }),
  });
}

export function getDatabaseClient(): PrismaClient {
  const prismaGlobal = globalThis as PrismaGlobal;

  if (!prismaGlobal.boardToDeathPrisma) {
    prismaGlobal.boardToDeathPrisma = createDatabaseClient();
  }

  return prismaGlobal.boardToDeathPrisma;
}
