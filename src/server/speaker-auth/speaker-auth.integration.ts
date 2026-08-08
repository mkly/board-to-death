import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { EventRepository } from "../events/repositories.ts";
import { DeterministicClock, DeterministicTokenGenerator } from "../infrastructure/fakes.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { SpeakerAuthError, SpeakerAuthService } from "./speaker-auth.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for speaker auth integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const speakers = new SpeakerRepository(client);
let auth: SpeakerAuthService;
let clock: DeterministicClock;

async function createSpeaker(slug: string) {
  const event = await events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-03-13T17:00:00.000Z"),
    endsAt: new Date("2027-03-15T00:00:00.000Z"),
  });
  const speaker = await speakers.create({
    eventId: event.id,
    email: `${slug}@example.test`,
    givenName: slug,
    familyName: "Speaker",
  });
  return { eventId: event.id, speakerId: speaker.id };
}

async function expectInvalidToken(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof SpeakerAuthError && error.code === "invalid-token",
  );
}

describe("speaker magic-link authentication", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    clock = new DeterministicClock("2027-01-01T12:00:00.000Z");
    auth = new SpeakerAuthService({
      database: client,
      clock,
      tokenGenerator: new DeterministicTokenGenerator("speaker-auth"),
    });
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("persists only a hash and rejects tampered, cross-speaker, expired, and replayed links", async () => {
    const first = await createSpeaker("first-speaker");
    const second = await createSpeaker("second-speaker");
    const issued = await auth.issueMagicLink(first);
    const stored = await client.speakerMagicLink.findFirstOrThrow({ where: first });

    assert.notEqual(stored.tokenHash, issued.token);
    assert.equal(JSON.stringify(stored).includes(issued.token), false);
    await expectInvalidToken(auth.consumeMagicLink({ ...first, token: `${issued.token}-tampered` }));
    await expectInvalidToken(auth.consumeMagicLink({ ...second, token: issued.token }));

    const session = await auth.consumeMagicLink({ ...first, token: issued.token });
    assert.deepEqual(await auth.getSession(session.sessionToken), {
      eventId: first.eventId,
      speakerId: first.speakerId,
      expiresAt: session.expiresAt,
    });
    await expectInvalidToken(auth.consumeMagicLink({ ...first, token: issued.token }));

    const expiring = await auth.issueMagicLink(first);
    clock.advanceBy(10 * 60 * 1000 + 1);
    await expectInvalidToken(auth.consumeMagicLink({ ...first, token: expiring.token }));
  });

  test("allows exactly one concurrent consumer", async () => {
    const identity = await createSpeaker("concurrent-speaker");
    const issued = await auth.issueMagicLink(identity);
    const results = await Promise.allSettled([
      auth.consumeMagicLink({ ...identity, token: issued.token }),
      auth.consumeMagicLink({ ...identity, token: issued.token }),
    ]);

    assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
    assert.equal(await client.speakerSession.count({ where: identity }), 1);
  });

  test("rotates an existing session and revokes the replacement on logout", async () => {
    const identity = await createSpeaker("rotated-speaker");
    const firstLink = await auth.issueMagicLink(identity);
    const firstSession = await auth.consumeMagicLink({ ...identity, token: firstLink.token });
    const secondLink = await auth.issueMagicLink(identity);
    const secondSession = await auth.consumeMagicLink({ ...identity, token: secondLink.token });

    assert.equal(await auth.getSession(firstSession.sessionToken), null);
    assert.notEqual(await auth.getSession(secondSession.sessionToken), null);
    await auth.logout(secondSession.sessionToken);
    assert.equal(await auth.getSession(secondSession.sessionToken), null);
  });
});
