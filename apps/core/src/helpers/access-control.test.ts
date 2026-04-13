import { type Prisma, TaskStatus } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import type {
  CoworkerAuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import {
  requireCoworkerCapability,
  requireCoworkerChatCapability,
  requireJobAccess,
  requireJobReadAccess,
  requireTaskAssignableCoworker,
  requireTaskReadAccess,
  requireUserTaskAccess,
} from "./access-control";

function createTransactionClient() {
  return {
    coworker: {
      findFirst: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    job: {
      findFirst: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient;
}

const userAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
};

const organizationWorkspaceContext: WorkspaceContext = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: null,
  organizationId: "org_123",
};

const personalWorkspaceContext: WorkspaceContext = {
  workspaceId: "22222222-2222-7222-8222-222222222222",
  userId: "user_123",
  organizationId: null,
};

describe("requireUserTaskAccess", () => {
  it("uses owner-only task access", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireUserTaskAccess(userAuthContext, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        userId: "user_123",
        archivedAt: null,
      },
    });
  });
});

describe("requireTaskReadAccess", () => {
  it("uses workspace-scoped reads in organization workspaces", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireTaskReadAccess(
      userAuthContext,
      organizationWorkspaceContext,
      "tsk_123",
      tx,
    );

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
    });
  });

  it("keeps personal workspace reads owner-scoped", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireTaskReadAccess(
      {
        ...userAuthContext,
        organizationId: null,
      },
      personalWorkspaceContext,
      "tsk_123",
      tx,
    );

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId: "22222222-2222-7222-8222-222222222222",
        userId: "user_123",
      },
    });
  });

  it("returns not found when no workspace context is available", async () => {
    const tx = createTransactionClient();

    await expect(
      requireTaskReadAccess(userAuthContext, null, "tsk_123", tx),
    ).rejects.toThrow("Task not found");

    expect(tx.task.findFirst).not.toHaveBeenCalled();
  });

  it("keeps coworker task reads unchanged", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findUnique).mockResolvedValueOnce({
      id: "tsk_123",
      coworkerId: "cow_123",
      status: TaskStatus.READY,
    } as never);

    await requireTaskReadAccess(coworkerContext, null, "tsk_123", tx);

    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        status: { not: TaskStatus.DRAFT },
        archivedAt: null,
      },
    });
  });
});

describe("requireTaskAssignableCoworker", () => {
  it("only accepts active whitelisted coworkers with tasks capability", async () => {
    const tx = {
      coworker: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cow_123",
          slug: "ops-agent",
          baseURL: null,
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await requireTaskAssignableCoworker("cow_123", tx);

    expect(tx.coworker.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
        isWhitelisted: true,
        capabilities: {
          has: "tasks",
        },
      },
      select: {
        id: true,
        slug: true,
        baseURL: true,
      },
    });
  });

  it("rejects non-assignable coworkers", async () => {
    const tx = {
      coworker: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(requireTaskAssignableCoworker("cow_123", tx)).rejects.toThrow(
      "Coworker not found",
    );
  });
});

describe("requireCoworkerCapability", () => {
  it("rejects unavailable coworker task capability with forbidden", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireCoworkerCapability("cow_123", "tasks", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");
  });
});

describe("requireCoworkerChatCapability", () => {
  it("requires whitelist, chat capability, and baseURL", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "https://responses.example.com/v1",
    } as never);

    await requireCoworkerChatCapability("cow_123", tx);

    expect(tx.coworker.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
        isWhitelisted: true,
        capabilities: {
          has: "chat",
        },
        baseURL: {
          not: null,
        },
      },
      select: {
        id: true,
        slug: true,
        baseURL: true,
      },
    });
  });
});

describe("requireJobReadAccess", () => {
  it("uses owner-only job reads", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireJobReadAccess(userAuthContext, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        userId: "user_123",
      },
    });
  });

  it("rejects when the requested job is not owned by the user", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobReadAccess(userAuthContext, "job_123", tx),
    ).rejects.toThrow("You can only access your own jobs");
  });
});

describe("requireJobAccess", () => {
  it("allows only owned jobs", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireJobAccess(userAuthContext, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ id: "job_123", userId: "user_123" }],
      },
    });
  });

  it("rejects jobs that are not owned by the current user", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobAccess(userAuthContext, "job_123", tx),
    ).rejects.toThrow("You can only access your own jobs");
  });
});
