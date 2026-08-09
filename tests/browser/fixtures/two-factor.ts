import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) throw new Error("The 2FA browser fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";

await database.verification.deleteMany();
await database.account.deleteMany();
await database.session.deleteMany();
await database.user.deleteMany();

let deliveredLink = "";
const browserAuth = createAuth({
  baseURL,
  database,
  isAllowedEmail: (email) => email === adminEmail,
  secret: "quality-gate-better-auth-secret-at-least-32-characters",
  sendMagicLink: async ({ url }) => {
    deliveredLink = url;
  },
});

await browserAuth.handler(
  new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ email: adminEmail, callbackURL: "/dashboard/account/security" }),
  }),
);
if (!deliveredLink) throw new Error("Expected the 2FA fixture magic link to be delivered.");

const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a 2FA browser session cookie.");

process.stdout.write(JSON.stringify({ sessionCookie }));
await database.$disconnect();
