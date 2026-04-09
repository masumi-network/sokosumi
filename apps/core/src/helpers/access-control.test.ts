import { type Prisma, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CoworkerAuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";

import {
  assertValidMemberIdFilter,
  buildWorkspaceWhere,
  requireCoworkerCapability,
  requireCoworkerChatCapability,
  requireCoworkerTaskAccess,
  requireOwnedJobAccess,
  requireOwnedTaskAccess,
  requireTaskAssignableCoworker,
  requireWorkspaceJobAccess,
  requireWorkspaceTaskAccess,
} from "./access-control";

const { getMemberByUserIdAndOrganizationIdMock, findWorkspaceForContextMock } =
  vi.hoisted(() => ({
    getMemberByUserIdAndOrganizationIdMock: vi.fn(),
    findWorkspaceForContextMock: vi.fn(),
  }));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    findWorkspaceForContext: findWorkspaceForContextMock,
  };
});

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();

  return {
    ...actual,
    memberRepository: {
      ...actual.memberRepository,
      getMemberByUserIdAndOrganizationId:
        getMemberByUserIdAndOrganizationIdMock,
    },
  };
});

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

describe("buildWorkspaceWhere", () => {
  it("builds workspace-only reads for organization workspaces", () => {
    expect(
      buildWorkspaceWhere({
        workspaceId: "workspace_123",
        userId: "user_123",
        organizationId: "org_123",
      }),
    ).toEqual({
      workspaceId: "workspace_123",
    });
  });

  it("keeps personal workspaces owner-scoped", () => {
    expect(
      buildWorkspaceWhere({
        workspaceId: "workspace_123",
        userId: "user_123",
        organizationId: null,
      }),
    ).toEqual({
      workspaceId: "workspace_123",
      userId: "user_123",
    });
  });

  it("uses the requested memberId inside organization workspaces", () => {
    expect(
      buildWorkspaceWhere(
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: "org_123",
        },
        "user_456",
      ),
    ).toEqual({
      workspaceId: "workspace_123",
      userId: "user_456",
    });
  });
});

describe("assertValidMemberIdFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      id: "member_123",
    });
  });

  it("rejects member filters in personal workspaces", async () => {
    await expect(
      assertValidMemberIdFilter(
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: null,
        },
        "user_456",
        {} as never,
      ),
    ).rejects.toThrow("memberId is only supported in organization workspaces.");
  });

  it("rejects memberId values outside the active organization", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(null);

    await expect(
      assertValidMemberIdFilter(
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: "org_123",
        },
        "user_456",
        {} as never,
      ),
    ).rejects.toThrow(
      "memberId must belong to the active organization workspace.",
    );
  });
});

describe("requireWorkspaceTaskAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a provided workspace context without re-resolving", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireWorkspaceTaskAccess(
      {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: "user_123",
        organizationId: "org_123",
      },
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
    expect(findWorkspaceForContextMock).not.toHaveBeenCalled();
  });

  it("treats a missing workspace as inaccessible", async () => {
    const tx = createTransactionClient();
    findWorkspaceForContextMock.mockResolvedValueOnce(null);

    await expect(
      requireWorkspaceTaskAccess(userAuthContext, "tsk_123", tx),
    ).rejects.toThrow("Task not found");
    expect(tx.task.findFirst).not.toHaveBeenCalled();
  });

  it("resolves organization workspace for workspace-wide reads", async () => {
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireWorkspaceTaskAccess(userAuthContext, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
    });
    expect(tx.task.findUnique).not.toHaveBeenCalled();
  });

  it("keeps personal workspace reads owner-scoped", async () => {
    findWorkspaceForContextMock.mockResolvedValue({
      id: "22222222-2222-7222-8222-222222222222",
    });
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireWorkspaceTaskAccess(
      {
        ...userAuthContext,
        organizationId: null,
      },
      "tsk_123",
      tx,
    );

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        userId: "user_123",
        workspaceId: "22222222-2222-7222-8222-222222222222",
      },
    });
  });
});

describe("requireOwnedTaskAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
  });

  it("uses owner-only task access in the active workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireOwnedTaskAccess(userAuthContext, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: "user_123",
        archivedAt: null,
      },
    });
  });
});

describe("requireCoworkerTaskAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads non-draft tasks assigned to the authenticated coworker", async () => {
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

    await requireCoworkerTaskAccess(coworkerContext, "tsk_123", tx);

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
  beforeEach(() => {
    vi.clearAllMocks();
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
  });

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unavailable coworker task capability with forbidden", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireCoworkerCapability("cow_123", "tasks", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");
  });
});

describe("requireCoworkerChatCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

describe("requireWorkspaceJobAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a provided workspace context without re-resolving", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireWorkspaceJobAccess(
      {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: "user_123",
        organizationId: "org_123",
      },
      "job_123",
      tx,
    );

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
    });
    expect(findWorkspaceForContextMock).not.toHaveBeenCalled();
  });

  it("resolves workspace-wide reads for organization workspaces from user auth", async () => {
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireWorkspaceJobAccess(userAuthContext, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
    });
  });

  it("keeps personal workspace reads owner-scoped when resolving from user auth", async () => {
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireWorkspaceJobAccess(
      {
        ...userAuthContext,
        organizationId: null,
      },
      "job_123",
      tx,
    );

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        userId: "user_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
    });
  });

  it("rejects inaccessible jobs after workspace resolution", async () => {
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireWorkspaceJobAccess(userAuthContext, "job_123", tx),
    ).rejects.toThrow("This job is not available in your active workspace.");
  });
});

describe("requireOwnedJobAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
  });

  it("keeps organization workspace job mutations owner-scoped", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireOwnedJobAccess(userAuthContext, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        userId: "user_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
    });
  });

  it("rejects owned jobs outside the active workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireOwnedJobAccess(userAuthContext, "job_123", tx),
    ).rejects.toThrow("You can only access your own jobs");
  });
});
