import { AgentJobStatus, type Prisma } from "@sokosumi/database";
import { jobSummaryInclude } from "@sokosumi/database/types/job";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import { getUserJobs, type JobContext } from "./job";

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
  role: "user",
};

const orgWorkspaceContext: WorkspaceContext = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: null,
  organizationId: "org_123",
};

const orgJobContext: JobContext = {
  userContext: { source: "session", ...orgAuthContext },
  workspaceContext: orgWorkspaceContext,
};

describe("getUserJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters jobs by active workspace and owner by default", async () => {
    const tx = createTransactionClient();

    await getUserJobs(orgJobContext, {
      take: 20,
      tx,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              userId: "user_123",
              workspaceId: orgWorkspaceContext.workspaceId,
            },
          ],
        },
        include: jobSummaryInclude,
      }),
    );
  });

  it("omits the authenticated user when scope=workspace", async () => {
    const tx = createTransactionClient();

    await getUserJobs(orgJobContext, {
      take: 20,
      scope: "workspace",
      tx,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              workspaceId: orgWorkspaceContext.workspaceId,
            },
          ],
        },
      }),
    );
  });

  it("uses personal workspace context with owner scoping when organization is missing", async () => {
    const tx = createTransactionClient();
    const personalContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    };
    const personalWorkspaceContext: WorkspaceContext = {
      workspaceId: "22222222-2222-7222-8222-222222222222",
      userId: "user_123",
      organizationId: null,
    };

    await getUserJobs(
      {
        userContext: { source: "session", ...personalContext },
        workspaceContext: personalWorkspaceContext,
      },
      {
        take: 20,
        tx,
      },
    );

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              userId: "user_123",
              workspaceId: personalWorkspaceContext.workspaceId,
            },
          ],
        },
      }),
    );
  });

  it("accepts any agent job status query without throwing", async () => {
    const tx = createTransactionClient();

    await getUserJobs(orgJobContext, {
      take: 20,
      tx,
      status: AgentJobStatus.COMPLETED,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              userId: "user_123",
              workspaceId: orgWorkspaceContext.workspaceId,
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

  it("filters jobs by projectId", async () => {
    const tx = createTransactionClient();
    const projectId = "33333333-3333-4333-8333-333333333333";

    await getUserJobs(orgJobContext, {
      take: 20,
      tx,
      projectId,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              userId: "user_123",
              workspaceId: orgWorkspaceContext.workspaceId,
            },
            { projectId },
          ],
        },
      }),
    );
  });

  it("filters jobs unassigned to a project", async () => {
    const tx = createTransactionClient();

    await getUserJobs(orgJobContext, {
      take: 20,
      tx,
      projectId: null,
    });

    expect(tx.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              userId: "user_123",
              workspaceId: orgWorkspaceContext.workspaceId,
            },
            { projectId: null },
          ],
        },
      }),
    );
  });
});
