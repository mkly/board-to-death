import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import {
  acceptContactGroupIntakeSubmission,
  closeContactGroupIntakeForm,
  listContactGroupIntakeSubmissions,
  publishContactGroupIntakeForm,
  rejectContactGroupIntakeSubmission,
  submitContactGroupIntakeForm,
} from "./group-intake.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for group intake integration tests.");
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: slug,
      slug,
      timezone: "UTC",
      startsAt: new Date("2027-06-01T09:00:00.000Z"),
      endsAt: new Date("2027-06-02T17:00:00.000Z"),
      sponsorsEnabled: true,
      exhibitorsEnabled: true,
    },
  });
}

describe("contact group intake", () => {
  before(async () => client.$connect());
  beforeEach(async () => client.event.deleteMany());
  after(async () => client.$disconnect());

  test("publishes, validates, closes, and isolates public forms", async () => {
    const event = await createEvent(`intake-${randomUUID()}`);
    const other = await createEvent(`intake-other-${randomUUID()}`);
    const form = await publishContactGroupIntakeForm(client, event.id, "SPONSOR", {
      title: "Sponsor interest",
      description: "Tell us about your organization.",
    });
    const foreignForm = await publishContactGroupIntakeForm(client, other.id, "SPONSOR", {
      title: "Other sponsor interest",
    });

    await assert.rejects(
      submitContactGroupIntakeForm(client, form.publicId, {
        organizationName: "Analytical Engines",
        contactGivenName: "Ada",
        contactFamilyName: "Lovelace",
        contactEmail: "not-an-email",
      }),
      (error: unknown) => error instanceof RepositoryError && error.code === "invalid-input",
    );
    await submitContactGroupIntakeForm(client, form.publicId, {
      organizationName: "Analytical Engines",
      contactGivenName: "Ada",
      contactFamilyName: "Lovelace",
      contactEmail: "ada@example.test",
    });
    await submitContactGroupIntakeForm(client, foreignForm.publicId, {
      organizationName: "Foreign Group",
      contactGivenName: "Foreign",
      contactFamilyName: "Contact",
      contactEmail: "foreign@example.test",
    });

    assert.deepEqual(
      (await listContactGroupIntakeSubmissions(client, event.id)).map(({ organizationName }) => organizationName),
      ["Analytical Engines"],
    );
    await closeContactGroupIntakeForm(client, event.id, "SPONSOR");
    await assert.rejects(
      submitContactGroupIntakeForm(client, form.publicId, {
        organizationName: "Closed response",
        contactGivenName: "Closed",
        contactFamilyName: "Response",
        contactEmail: "closed@example.test",
      }),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
  });

  test("accepts atomically and matches repeat organizations without duplicate groups", async () => {
    const event = await createEvent(`review-${randomUUID()}`);
    const other = await createEvent(`review-other-${randomUUID()}`);
    const reviewer = await client.user.create({
      data: {
        id: randomUUID(),
        name: "Intake Reviewer",
        email: `reviewer-${randomUUID()}@example.test`,
        emailVerified: true,
      },
    });
    const form = await publishContactGroupIntakeForm(client, event.id, "SPONSOR", { title: "Sponsor interest" });
    const first = await submitContactGroupIntakeForm(client, form.publicId, {
      organizationName: "Analytical Engines",
      contactGivenName: "Ada",
      contactFamilyName: "Lovelace",
      contactEmail: "ada@example.test",
      contactJobTitle: "Founder",
    });
    const second = await submitContactGroupIntakeForm(client, form.publicId, {
      organizationName: "analytical engines",
      contactGivenName: "Grace",
      contactFamilyName: "Hopper",
      contactEmail: "grace@example.test",
    });

    await assert.rejects(
      acceptContactGroupIntakeSubmission(client, other.id, first.id, reviewer.id),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
    const acceptedFirst = await acceptContactGroupIntakeSubmission(client, event.id, first.id, reviewer.id);
    const acceptedSecond = await acceptContactGroupIntakeSubmission(client, event.id, second.id, reviewer.id);

    assert.equal(acceptedSecond.groupId, acceptedFirst.groupId);
    assert.equal(await client.contactGroup.count({ where: { eventId: event.id } }), 1);
    const group = await client.contactGroup.findUniqueOrThrow({
      where: { eventId_id: { eventId: event.id, id: acceptedFirst.groupId } },
      include: { primaryContact: true, members: true },
    });
    assert.equal(group.primaryContact?.email, "grace@example.test");
    assert.equal(group.members.length, 2);
    assert.equal(
      await client.contactGroupIntakeSubmission.count({ where: { eventId: event.id, status: "ACCEPTED" } }),
      2,
    );

    const rejected = await submitContactGroupIntakeForm(client, form.publicId, {
      organizationName: "Rejected Labs",
      contactGivenName: "Rejected",
      contactFamilyName: "Contact",
      contactEmail: "rejected@example.test",
    });
    await rejectContactGroupIntakeSubmission(client, event.id, rejected.id, reviewer.id);
    assert.equal(
      (await client.contactGroupIntakeSubmission.findUniqueOrThrow({ where: { id: rejected.id } })).status,
      "REJECTED",
    );
    assert.equal(await client.contactGroup.count({ where: { eventId: event.id, slug: "rejected-labs" } }), 0);
  });
});
