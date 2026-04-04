import { AgentJobStatus, JobType, type Prisma } from "@sokosumi/database";
import { jobSummaryInclude } from "@sokosumi/database/types/job";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";

import { getUserJobs } from "./job";

const { resolveWorkspaceForContextMock } = vi.hoisted(() => ({
  resolveWorkspaceForContextMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    resolveWorkspaceForContext: (...args: unknown[]) =>
      resolveWorkspaceForContextMock(...args),
  };
});

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

function createSummaryJob(id: string, status: AgentJobStatus) {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");

  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    agentId: "agent_123",
    userId: "user_123",
    organizationId: "org_123",
    taskId: null,
    name: id,
    jobType: JobType.FREE,
    transaction: null,
    purchase: null,
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Test Org",
        slug: "test-org",
      },
    },
    events: [
      {
        id: `evt_${id}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        status,
        result: status === AgentJobStatus.COMPLETED ? `Result for ${id}` : null,
        input: null,
        inputSchema: null,
        blobs: [],
        links: [],
      },
    ],
  } as never;
}

describe("getUserJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the active workspace before reading jobs", async () => {
    const tx = createTransactionClient();
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });

    await getUserJobs(orgAuthContext, {
      take: 20,
      tx,
    });

    expect(resolveWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      tx,
    );
  });

  it("filters org jobs by active workspace", async () => {
    const tx = createTransactionClient();
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });

    await getUserJobs(orgAuthContext, {
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
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "22222222-2222-7222-8222-222222222222",
    });
    const personalContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    };

    await getUserJobs(personalContext, {
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

  it("accepts any agent job status query without throwing", async () => {
    const tx = createTransactionClient();
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });

    await getUserJobs(orgAuthContext, {
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

  it("uses a full-list scan for totals when excluding failed jobs on cursor pages", async () => {
    const tx = createTransactionClient();
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    vi.mocked(tx.job.findMany).mockResolvedValue([]);

    await getUserJobs(orgAuthContext, {
      take: 10,
      tx,
      includeFailed: false,
      cursor: "job_after_first_page",
      skip: 1,
    });

    const calls = vi
      .mocked(tx.job.findMany)
      .mock.calls.map(
        (args) => args[0] as { cursor?: { id: string }; skip?: number },
      );

    expect(calls.some((c) => c.cursor?.id === "job_after_first_page")).toBe(
      true,
    );
    expect(calls.some((c) => c.cursor === undefined)).toBe(true);
  });

  it("stops cursor page scans once enough visible jobs are collected", async () => {
    const tx = createTransactionClient();
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });

    const pageBatch = Array.from({ length: 50 }, (_, index) =>
      createSummaryJob(
        index === 49 ? "page_job_50" : `page_job_${index + 1}`,
        index < 3 ? AgentJobStatus.COMPLETED : AgentJobStatus.FAILED,
      ),
    );
    const countBatch = Array.from({ length: 50 }, (_, index) =>
      createSummaryJob(
        index === 49 ? "count_job_50" : `count_job_${index + 1}`,
        AgentJobStatus.COMPLETED,
      ),
    );

    vi.mocked(tx.job.findMany).mockImplementation(async (args) => {
      const cursorId = (args as { cursor?: { id: string } }).cursor?.id;

      if (!cursorId) {
        return countBatch;
      }

      if (cursorId === "count_job_50") {
        return [createSummaryJob("count_job_51", AgentJobStatus.COMPLETED)];
      }

      if (cursorId === "job_after_first_page") {
        return pageBatch;
      }

      if (cursorId === "page_job_50") {
        throw new Error(
          "cursor page scan should stop after enough visible jobs",
        );
      }

      throw new Error(`Unexpected cursor ${cursorId}`);
    });

    const result = await getUserJobs(orgAuthContext, {
      take: 2,
      tx,
      includeFailed: false,
      cursor: "job_after_first_page",
      skip: 1,
    });

    expect(result.jobs).toHaveLength(2);
    expect(result.count).toBe(51);
    expect(result.hasMore).toBe(true);
  });
});
