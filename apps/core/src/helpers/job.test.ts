import { AgentJobStatus, type Prisma } from "@sokosumi/database";
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
});
