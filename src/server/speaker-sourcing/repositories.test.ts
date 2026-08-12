import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { RepositoryError } from "../events/repositories.ts";
import { SpeakerSourcingRepository } from "./repositories.ts";

describe("SpeakerSourcingRepository public interest identifiers", () => {
  it("treats malformed public identifiers as unavailable without querying the database", async () => {
    const findFirst = vi.fn(() => {
      throw new Error("The database should not be queried for a malformed UUID.");
    });
    const repository = new SpeakerSourcingRepository({
      speakerInterestForm: { findFirst },
    } as unknown as PrismaClient);

    await expect(repository.findPublishedInterestForm("custom-handle")).resolves.toBeNull();
    await expect(
      repository.submitInterest({
        publicId: "custom-handle",
        email: "speaker@example.test",
        givenName: "Sage",
        familyName: "Meeple",
      }),
    ).rejects.toMatchObject({
      code: "not-found",
      message: "This speaker interest form is not available.",
    } satisfies Partial<RepositoryError>);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
