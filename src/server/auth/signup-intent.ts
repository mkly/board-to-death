import { z } from "zod";

import { OrganizationMemberRole, type PrismaClient } from "@/generated/prisma/client";

import { createHash, randomBytes, randomUUID } from "node:crypto";

const SIGNUP_CALLBACK_PATH = "/auth/v1/register/complete";
const SIGNUP_INTENT_PREFIX = "organization-signup:";
const SIGNUP_INTENT_TTL_MS = 10 * 60 * 1000;

const storedIntentSchema = z.object({
  email: z.email(),
  organizationName: z.string().min(1),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function intentIdentifier(token: string): string {
  return `${SIGNUP_INTENT_PREFIX}${createHash("sha256").update(token).digest("hex")}`;
}

export async function createOrganizationSignupIntent(
  database: PrismaClient,
  input: { readonly email: string; readonly organizationName: string },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await database.verification.create({
    data: {
      id: randomUUID(),
      identifier: intentIdentifier(token),
      value: JSON.stringify({
        email: normalizeEmail(input.email),
        organizationName: input.organizationName.trim(),
      }),
      expiresAt: new Date(Date.now() + SIGNUP_INTENT_TTL_MS),
    },
  });
  return token;
}

export async function consumeOrganizationSignupIntent(
  database: PrismaClient,
  input: { readonly token: string; readonly userId: string; readonly email: string },
): Promise<{ readonly id: string; readonly name: string } | null> {
  return database.$transaction(async (transaction) => {
    const intent = await transaction.verification.findFirst({
      where: { identifier: intentIdentifier(input.token), expiresAt: { gt: new Date() } },
      select: { id: true, value: true },
    });
    if (!intent) return null;

    const parsed = storedIntentSchema.safeParse(JSON.parse(intent.value));
    if (!parsed.success || normalizeEmail(parsed.data.email) !== normalizeEmail(input.email)) return null;

    const consumed = await transaction.verification.deleteMany({ where: { id: intent.id } });
    if (consumed.count !== 1) return null;

    return transaction.organization.create({
      data: {
        name: parsed.data.organizationName,
        slug: `organization-${randomUUID()}`,
        members: {
          create: { userId: input.userId, role: OrganizationMemberRole.OWNER },
        },
      },
      select: { id: true, name: true },
    });
  });
}

export function organizationSignupCallback(token: string): string {
  return `${SIGNUP_CALLBACK_PATH}?intent=${encodeURIComponent(token)}`;
}
