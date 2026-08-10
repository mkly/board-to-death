import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import {
  consumeOrganizationSignupIntent,
  createOrganizationSignupIntent,
  organizationSignupCallback,
} from "./signup-intent";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;
const integrationDescribe = databaseUrl?.includes("_test") ? describe : describe.skip;
const email = `signup-intent-${randomUUID()}@example.test`;
let database: PrismaClient;
let userId: string;

integrationDescribe("organization signup intent", () => {
  beforeAll(async () => {
    if (!databaseUrl?.includes("_test")) throw new Error("Signup intent tests require a guarded *_test DATABASE_URL");
    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    userId = randomUUID();
    await database.user.create({
      data: { id: userId, name: "Signup owner", email, emailVerified: true },
    });
  });

  afterAll(async () => {
    await database.organization.deleteMany({ where: { members: { some: { userId } } } });
    await database.verification.deleteMany({ where: { value: { contains: email } } });
    await database.user.deleteMany({ where: { id: userId } });
    await database.$disconnect();
  });

  test("provisions exactly one owner organization from a signup intent", async () => {
    const token = await createOrganizationSignupIntent(database, { email, organizationName: "Intent Games" });
    expect(organizationSignupCallback(token)).toContain(encodeURIComponent(token));

    await expect(
      consumeOrganizationSignupIntent(database, { token, userId, email: "other@example.test" }),
    ).resolves.toBeNull();

    const organization = await consumeOrganizationSignupIntent(database, { token, userId, email });
    expect(organization?.name).toBe("Intent Games");
    await expect(consumeOrganizationSignupIntent(database, { token, userId, email })).resolves.toBeNull();
    await expect(
      database.organizationMember.findUnique({
        where: { orgId_userId: { orgId: organization?.id ?? "", userId } },
      }),
    ).resolves.toMatchObject({ role: "OWNER", status: "ACTIVE" });
  });
});
