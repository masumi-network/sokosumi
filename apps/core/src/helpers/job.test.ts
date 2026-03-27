import { AgentJobStatus, type Prisma } from "@sokosumi/database";
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
          AND: [
            {
              OR: [{ userId: "user_123", organizationId: "org_123" }],
            },
          ],
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
          AND: [
            {
              OR: [{ userId: "user_123" }],
            },
          ],
        },
      }),
    );
  });

  it("unions composed scopes with OR behavior", async () => {
    const tx = createTransactionClient();

    await getUserJobs(orgAuthContext, {
      take: 20,
      tx,
      scopes: ["context", "owned"],
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { userId: "user_123", organizationId: "org_123" },
                { userId: "user_123" },
              ],
            },
          ],
        },
      }),
    );
  });

  it("uses personal context when organization is missing", async () => {
    const tx = createTransactionClient();
    const personalContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    };

    await getUserJobs(personalContext, {
      take: 20,
      tx,
      scopes: ["context"],
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [{ userId: "user_123", organizationId: null }],
            },
          ],
        },
      }),
    );
  });

  it("accepts any agent job status query without throwing", async () => {
    const tx = createTransactionClient();

    await getUserJobs(orgAuthContext, {
      take: 20,
      tx,
      scopes: ["context", "owned"],
      status: AgentJobStatus.COMPLETED,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { userId: "user_123", organizationId: "org_123" },
                { userId: "user_123" },
              ],
            },
            {
              events: {
                some: { status: { equals: AgentJobStatus.COMPLETED } },
              },
            },
          ],
        },
      }),
    );
  });
});
