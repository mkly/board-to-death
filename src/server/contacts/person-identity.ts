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
  input: PersonIdentityInput,
): Promise<Person> {
  return await client.person.upsert({
    where: { email: input.email },
    update: {},
    create: {
      email: input.email,
      givenName: input.givenName,
      familyName: input.familyName,
      organization: input.organization ?? null,
      jobTitle: input.jobTitle ?? null,
      phone: input.phone ?? null,
    },
  });
}
