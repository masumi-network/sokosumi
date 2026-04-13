import { AgentJobStatus, type Prisma } from "@sokosumi/database";
import { jobSummaryInclude } from "@sokosumi/database/types/job";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters org jobs by active workspace", async () => {
    const tx = createTransactionClient();
    const workspaceContext: WorkspaceContext = {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    };

    await getUserJobs(orgAuthContext, {
      workspaceContext,
      take: 20,
      tx,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              workspaceId: "11111111-1111-7111-8111-111111111111",
            },
          ],
        },
        include: jobSummaryInclude,
      }),
    );
  });

  it("uses personal context when organization is missing", async () => {
    const tx = createTransactionClient();
    const workspaceContext: WorkspaceContext = {
      workspaceId: "22222222-2222-7222-8222-222222222222",
      userId: "user_123",
      organizationId: null,
    };
    const personalContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    };

    await getUserJobs(personalContext, {
      workspaceContext,
      take: 20,
      tx,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              userId: "user_123",
              workspaceId: "22222222-2222-7222-8222-222222222222",
            },
          ],
        },
      }),
    );
  });

  it("returns an empty page when no workspace path resolves", async () => {
    const tx = createTransactionClient();

    await expect(
      getUserJobs(orgAuthContext, {
        workspaceContext: null,
        take: 20,
        tx,
      }),
    ).resolves.toEqual({
      jobs: [],
      count: 0,
      hasMore: false,
    });
    expect(tx.job.findMany).not.toHaveBeenCalled();
    expect(tx.job.count).not.toHaveBeenCalled();
  });

  it("uses memberId when reading jobs in an org workspace", async () => {
    const tx = createTransactionClient();
    const workspaceContext: WorkspaceContext = {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    };

    await getUserJobs(orgAuthContext, {
      workspaceContext,
      memberId: "user_456",
      take: 20,
      tx,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              userId: "user_456",
              workspaceId: "11111111-1111-7111-8111-111111111111",
            },
          ],
        },
      }),
    );
  });

  it("accepts any agent job status query without throwing", async () => {
    const tx = createTransactionClient();
    const workspaceContext: WorkspaceContext = {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    };

    await getUserJobs(orgAuthContext, {
      workspaceContext,
      take: 20,
      tx,
      status: AgentJobStatus.COMPLETED,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              workspaceId: "11111111-1111-7111-8111-111111111111",
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
