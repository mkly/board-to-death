import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";

import { CfpPublicAccessRepository } from "./public-access";

function repository() {
  const findFirst = vi.fn().mockResolvedValue(null);
  const client = { cfpPolicy: { findFirst } } as unknown as PrismaClient;
  return { findFirst, repository: new CfpPublicAccessRepository(client) };
}

describe("CfpPublicAccessRepository", () => {
  it("looks up published CFP forms by event slug", async () => {
    const { findFirst, repository: publicAccess } = repository();

    await expect(publicAccess.findByPublicId("board-to-death-demo")).resolves.toEqual({ status: "unknown" });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        where: {
          event: { slug: "board-to-death-demo" },
          publishedFormVersionId: { not: null },
          status: "PUBLISHED",
        },
      }),
    );
  });

  it("keeps UUID links scoped to their exact public ID", async () => {
    const { findFirst, repository: publicAccess } = repository();
    const publicId = "d9428888-122b-4b1d-8a6f-19e267e1f79a";

    await publicAccess.findByPublicId(publicId);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: undefined,
        where: { publicId },
      }),
    );
  });
});
