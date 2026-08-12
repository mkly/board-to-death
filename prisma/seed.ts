import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { createDemoOrgFixtures } from "../src/server/database/demo-org-fixtures.ts";
import { createRepresentativeFixtures } from "../src/server/database/representative-fixtures.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed representative fixtures.");
}

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const fixture = await createRepresentativeFixtures(client);
  console.log(`Seeded representative event ${fixture.eventSlug} (${fixture.eventId}).`);
  const demo = await createDemoOrgFixtures(client);
  console.log(
    `Seeded demo org ${demo.organizationSlug} with events ${demo.summitEventSlug} and ${demo.playtestEventSlug}.`,
  );
  console.log(`Demo sign-in emails (magic link): ${demo.demoUserEmails.join(", ")}`);
} finally {
  await client.$disconnect();
}
