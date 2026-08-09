import type { Person, Prisma } from "../../generated/prisma/client.ts";

export interface PersonIdentityInput {
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organization?: string | null;
  readonly jobTitle?: string | null;
  readonly phone?: string | null;
}

/** Resolve a stable person identity without overwriting directory-owned profile data. */
export async function resolvePersonIdentity(
  client: Prisma.TransactionClient,
  eventId: string,
  input: PersonIdentityInput,
): Promise<Person> {
  const event = await client.event.findUniqueOrThrow({ where: { id: eventId }, select: { orgId: true } });
  return await client.person.upsert({
    where: { orgId_email: { orgId: event.orgId, email: input.email } },
    update: {},
    create: {
      orgId: event.orgId,
      email: input.email,
      givenName: input.givenName,
      familyName: input.familyName,
      organization: input.organization ?? null,
      jobTitle: input.jobTitle ?? null,
      phone: input.phone ?? null,
    },
  });
}
