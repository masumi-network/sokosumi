import { type Prisma, TaskStatus } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import type {
  CoworkerAuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";

import {
  requireScopedJobReadAccess,
  requireScopedTaskReadAccess,
  requireTaskAccess,
  requireUserTaskAccess,
} from "./access-control";

function createTransactionClient() {
  return {
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

describe("requireUserTaskAccess", () => {
  it("uses strict context ownership", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findUnique).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireUserTaskAccess(userAuthContext, "tsk_123", tx);

    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        userId: "user_123",
        organizationId: "org_123",
        archivedAt: null,
      },
    });
  });
});

describe("requireScopedTaskReadAccess", () => {
  it("uses context scope by default", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireScopedTaskReadAccess(
      userAuthContext,
      "tsk_123",
      ["context"],
      tx,
    );

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        OR: [{ userId: "user_123", organizationId: "org_123" }],
      },
    });
  });

  it("uses user ownership only with owned scope", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireScopedTaskReadAccess(
      userAuthContext,
      "tsk_123",
      ["owned"],
      tx,
    );

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        OR: [{ userId: "user_123" }],
      },
    });
  });
});

describe("requireTaskAccess", () => {
  it("keeps coworker access path unchanged", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
    };

    vi.mocked(tx.task.findUnique).mockResolvedValueOnce({
      id: "tsk_123",
      coworkerId: "cow_123",
      status: TaskStatus.READY,
    } as never);

    await requireTaskAccess(coworkerContext, "tsk_123", tx);

    expect(tx.task.findFirst).not.toHaveBeenCalled();
    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        status: { not: TaskStatus.DRAFT },
        archivedAt: null,
      },
    });
  });
});

describe("requireScopedJobReadAccess", () => {
  it("uses context scope without implicit shared fallback", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireScopedJobReadAccess(
      userAuthContext,
      "job_123",
      ["context"],
      tx,
    );

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        OR: [{ userId: "user_123", organizationId: "org_123" }],
      },
    });
  });

  it("uses shared scope for organization shares", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireScopedJobReadAccess(
      userAuthContext,
      "job_123",
      ["shared"],
      tx,
    );

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        OR: [{ share: { organizationId: "org_123" } }],
      },
    });
  });

  it("uses OR union for composed scopes", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireScopedJobReadAccess(
      userAuthContext,
      "job_123",
      ["owned", "shared"],
      tx,
    );

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        OR: [{ userId: "user_123" }, { share: { organizationId: "org_123" } }],
      },
    });
  });

  it("rejects shared-only scope when organization context is missing", async () => {
    const tx = createTransactionClient();
    const personalContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    };

    await expect(
      requireScopedJobReadAccess(personalContext, "job_123", ["shared"], tx),
    ).rejects.toThrow("You can only access jobs within the requested scope");

    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });
});
