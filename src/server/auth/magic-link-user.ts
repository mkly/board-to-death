import type { PrismaClient } from "@/generated/prisma/client";

import { randomUUID } from "node:crypto";

export async function provisionMagicLinkUser(
  database: PrismaClient,
  input: { readonly email: string; readonly name?: string },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const name = input.name?.trim() || email.split("@")[0] || email;

  await database.user.upsert({
    where: { email },
    update: {},
    create: { id: randomUUID(), email, name, emailVerified: false },
  });
}
