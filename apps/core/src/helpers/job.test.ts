import { AgentJobStatus, type Prisma } from "@sokosumi/database";
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

  it("filters jobs by active workspace and owner", async () => {
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
              userId: "user_123",
              workspaceId: "11111111-1111-7111-8111-111111111111",
            },
          ],
        },
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
              userId: "user_123",
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
