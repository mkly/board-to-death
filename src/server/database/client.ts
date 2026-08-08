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

export function createDatabaseClient(databaseUrl = requireDatabaseUrl()): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

export function getDatabaseClient(): PrismaClient {
  const prismaGlobal = globalThis as PrismaGlobal;

  if (!prismaGlobal.boardToDeathPrisma) {
    prismaGlobal.boardToDeathPrisma = createDatabaseClient();
  }

  return prismaGlobal.boardToDeathPrisma;
}
