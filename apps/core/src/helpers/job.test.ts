import type { Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";

import { getUserJobs } from "./job";

function createTransactionClient() {
  return {
    job: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  } as unknown as Prisma.TransactionClient;
}

const orgAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
};

describe("getUserJobs", () => {
  it("uses context scope by default", async () => {
    const tx = createTransactionClient();

    await getUserJobs(orgAuthContext, {
      take: 20,
      tx,
      scopes: ["context"],
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ userId: "user_123", organizationId: "org_123" }],
        },
      }),
    );
  });

  it("uses user-only ownership with owned scope", async () => {
    const tx = createTransactionClient();

    await getUserJobs(orgAuthContext, {
      take: 20,
      tx,
      scopes: ["owned"],
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ userId: "user_123" }],
        },
      }),
    );
  });

  it("unions composed scopes with OR behavior", async () => {
    const tx = createTransactionClient();

    await getUserJobs(orgAuthContext, {
      take: 20,
      tx,
      scopes: ["context", "shared"],
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { userId: "user_123", organizationId: "org_123" },
            { share: { organizationId: "org_123" } },
          ],
        },
      }),
    );
  });

  it("returns empty result for shared-only scope without organization", async () => {
    const tx = createTransactionClient();
    const personalContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    };

    const result = await getUserJobs(personalContext, {
      take: 20,
      tx,
      scopes: ["shared"],
    });

    expect(result).toEqual({
      jobs: [],
      count: 0,
      hasMore: false,
    });
    expect(tx.job.findMany).not.toHaveBeenCalled();
    expect(tx.job.count).not.toHaveBeenCalled();
  });
});
