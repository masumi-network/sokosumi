import { CoworkerGrantScope, type Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";
import type {
  CoworkerAuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

const {
  hasCoworkerGrantMock,
  requestCoworkerGrantMock,
  requireCoworkerGrantMock,
} = vi.hoisted(() => ({
  hasCoworkerGrantMock: vi.fn(),
  requestCoworkerGrantMock: vi.fn(),
  requireCoworkerGrantMock: vi.fn(),
}));

vi.mock("./coworker-grants", () => ({
  GRANT_REQUIRED_ERROR_KIND: "grant_required",
  hasCoworkerGrant: hasCoworkerGrantMock,
  requestCoworkerGrant: requestCoworkerGrantMock,
  requireCoworkerGrant: requireCoworkerGrantMock,
}));

import {
  requireConversationCoworkerAccess,
  requireCoworkerCapability,
  requireCoworkerChatCapability,
  requireCoworkerTaskCollaboration,
  requireJobCollaboration,
  requireJobOwnership,
  requireJobRead,
  requireJobReadForRouteVars,
  requireTaskAssignableCoworker,
  requireTaskCollaboration,
  requireTaskOwnership,
  requireTaskReadForRouteVars,
  requireTaskReadForWorkspace,
  resolveConversationCoworkerId,
  resolveTaskCommentAccess,
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

beforeEach(() => {
  vi.clearAllMocks();
  requireCoworkerGrantMock.mockResolvedValue(undefined);
  hasCoworkerGrantMock.mockResolvedValue(false);
  requestCoworkerGrantMock.mockResolvedValue("grant_1");
});

const userAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const sessionUserContext = { source: "session" as const, ...userAuthContext };

const workspaceId = "11111111-1111-7111-8111-111111111111";

const jobReadWorkspaceContext: WorkspaceContext = {
  workspaceId,
  userId: null,
  organizationId: "org_123",
};

describe("requireTaskOwnership", () => {
  it("uses owner-only task access", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireTaskOwnership(sessionUserContext, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        userId: "user_123",
        archivedAt: null,
      },
    });
  });
});

describe("requireTaskCollaboration", () => {
  it("uses ownership for users", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireTaskCollaboration(userAuthContext, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        userId: "user_123",
        archivedAt: null,
      },
    });
  });

  it("uses coworker task access for coworkers", async () => {
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

    await requireTaskCollaboration(coworkerContext, "tsk_123", tx);

    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        status: { not: TaskStatus.DRAFT },
        awaitingAcceptance: false,
        archivedAt: null,
      },
    });
  });

  it("rejects coworkers without tasks capability before loading the task", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireTaskCollaboration(coworkerContext, "tsk_123", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");

    expect(tx.task.findUnique).not.toHaveBeenCalled();
  });

  it("rejects delegated coworkers without tasks capability before loading the task", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
      delegation: {
        userId: "user_delegate",
        organizationId: "org_123",
      },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireTaskCollaboration(coworkerContext, "tsk_123", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");

    expect(tx.task.findFirst).not.toHaveBeenCalled();
    expect(tx.task.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a delegated coworker acting on a task assigned to another coworker", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
      delegation: {
        userId: "user_delegate",
        organizationId: "org_123",
      },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      coworkerId: "cow_other",
    } as never);

    await expect(
      requireTaskCollaboration(coworkerContext, "tsk_123", tx),
    ).rejects.toThrow("You can only act on tasks assigned to your coworker");
  });
});

describe("resolveTaskCommentAccess", () => {
  const delegatedContext: CoworkerAuthenticationContext = {
    actor: "coworker",
    coworkerId: "cow_123",
    delegation: {
      userId: "user_delegate",
      organizationId: "org_123",
    },
  };

  function delegatedVars(): EnvVariables["Variables"] {
    return {
      isAuthenticated: true,
      authContext: delegatedContext,
      workspaceContext: jobReadWorkspaceContext,
    };
  }

  function mockDelegatedCoworkerAndTask(
    tx: Prisma.TransactionClient,
    coworkerId = "cow_other",
    task: Record<string, unknown> = {},
  ) {
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      userId: "user_delegate",
      awaitingAcceptance: false,
      coworkerId,
      ...task,
    } as never);
  }

  it("lets a workspace member comment via the workspace read gate", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      userId: "user_colleague",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    const access = await resolveTaskCommentAccess(vars, "tsk_123", tx);

    // Workspace scoping, not ownership: the colleague's task resolves.
    expect(access.task).toMatchObject({ id: "tsk_123" });
    expect(access.heldByGrantId).toBeNull();
    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId,
      },
    });
  });

  it("passes a granted delegated coworker through unheld", async () => {
    const tx = createTransactionClient();
    mockDelegatedCoworkerAndTask(tx);
    hasCoworkerGrantMock.mockResolvedValueOnce(true);

    const access = await resolveTaskCommentAccess(
      delegatedVars(),
      "tsk_123",
      tx,
    );

    expect(access.heldByGrantId).toBeNull();
    expect(requestCoworkerGrantMock).not.toHaveBeenCalled();
    expect(hasCoworkerGrantMock).toHaveBeenCalledWith(
      "cow_123",
      "user_delegate",
      CoworkerGrantScope.TASK_COMMENT,
      tx,
    );
  });

  it("holds an ungranted delegated comment under the pending grant", async () => {
    const tx = createTransactionClient();
    mockDelegatedCoworkerAndTask(tx);
    requestCoworkerGrantMock.mockResolvedValueOnce("grant_9");

    const access = await resolveTaskCommentAccess(
      delegatedVars(),
      "tsk_123",
      tx,
    );

    expect(access.heldByGrantId).toBe("grant_9");
    expect(requestCoworkerGrantMock).toHaveBeenCalledWith(
      "cow_123",
      "user_delegate",
      CoworkerGrantScope.TASK_COMMENT,
    );
  });

  it("throws grant_required when the user already denied the coworker", async () => {
    const tx = createTransactionClient();
    mockDelegatedCoworkerAndTask(tx);
    requestCoworkerGrantMock.mockResolvedValueOnce(null);

    await expect(
      resolveTaskCommentAccess(delegatedVars(), "tsk_123", tx),
    ).rejects.toThrow("needs your approval");
  });

  it("skips the grant machinery when the task is assigned to the delegated coworker", async () => {
    const tx = createTransactionClient();
    mockDelegatedCoworkerAndTask(tx, "cow_123");

    const access = await resolveTaskCommentAccess(
      delegatedVars(),
      "tsk_123",
      tx,
    );

    expect(access.heldByGrantId).toBeNull();
    expect(hasCoworkerGrantMock).not.toHaveBeenCalled();
    expect(requestCoworkerGrantMock).not.toHaveBeenCalled();
  });

  it("404s when the task is not in the active workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(null);

    await expect(
      resolveTaskCommentAccess(delegatedVars(), "tsk_123", tx),
    ).rejects.toThrow("Task not found");
    expect(requestCoworkerGrantMock).not.toHaveBeenCalled();
  });

  it("404s awaiting-acceptance tasks for delegated coworkers", async () => {
    const tx = createTransactionClient();
    mockDelegatedCoworkerAndTask(tx, "cow_123", { awaitingAcceptance: true });

    await expect(
      resolveTaskCommentAccess(delegatedVars(), "tsk_123", tx),
    ).rejects.toThrow("Task not found");
    expect(requestCoworkerGrantMock).not.toHaveBeenCalled();
  });

  it("lets a granted delegated coworker comment on a colleague's task", async () => {
    const tx = createTransactionClient();
    mockDelegatedCoworkerAndTask(tx, "cow_other", {
      userId: "user_colleague",
    });
    hasCoworkerGrantMock.mockResolvedValueOnce(true);

    const access = await resolveTaskCommentAccess(
      delegatedVars(),
      "tsk_123",
      tx,
    );

    expect(access.heldByGrantId).toBeNull();
  });

  it("rejects ungranted comments on colleague-owned tasks without holding", async () => {
    const tx = createTransactionClient();
    mockDelegatedCoworkerAndTask(tx, "cow_other", {
      userId: "user_colleague",
    });
    // The request is still recorded for the delegating user to approve,
    // but the comment cannot be held: only the task owner could release
    // it, and they cannot resolve this coworker's grant.
    requestCoworkerGrantMock.mockResolvedValueOnce("grant_9");

    await expect(
      resolveTaskCommentAccess(delegatedVars(), "tsk_123", tx),
    ).rejects.toThrow("needs your approval");
    expect(requestCoworkerGrantMock).toHaveBeenCalled();
  });
});

describe("requireTaskReadForWorkspace", () => {
  it("uses workspace-scoped user reads", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    await requireTaskReadForWorkspace(jobReadWorkspaceContext, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId,
      },
    });
  });

  it("returns not found when workspace id is empty and no task matches", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireTaskReadForWorkspace(
        { workspaceId: "", userId: null, organizationId: null },
        "tsk_123",
        tx,
      ),
    ).rejects.toThrow("Task not found");

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId: "",
      },
    });
  });
});

describe("requireTaskReadForRouteVars", () => {
  it("delegates to workspace read for users", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskReadForRouteVars(vars, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId,
      },
    });
  });

  it("rejects user reads when workspace context is missing", async () => {
    const tx = createTransactionClient();

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: null,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_123", tx),
    ).rejects.toThrow("Workspace is missing");

    expect(tx.task.findFirst).not.toHaveBeenCalled();
  });

  it("delegates to coworker read for coworkers", async () => {
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

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: null,
    };

    await requireTaskReadForRouteVars(vars, "tsk_123", tx);

    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        status: { not: TaskStatus.DRAFT },
        awaitingAcceptance: false,
        archivedAt: null,
      },
    });
  });

  it("delegates coworker reads with delegation to workspace read", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
      delegation: {
        userId: "user_delegate",
        organizationId: "org_123",
      },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      coworkerId: "cow_123",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskReadForRouteVars(vars, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId,
      },
    });
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
    expect(tx.task.findUnique).not.toHaveBeenCalled();
  });

  it("rejects delegated coworker reads without tasks capability before loading the task", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
      delegation: {
        userId: "user_delegate",
        organizationId: "org_123",
      },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_123", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");

    expect(tx.task.findFirst).not.toHaveBeenCalled();
    expect(tx.task.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a delegated coworker reading a task not assigned to it", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
      delegation: {
        userId: "user_delegate",
        organizationId: "org_123",
      },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    // Task is in the delegated user's workspace but assigned to another coworker.
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      coworkerId: "cow_other",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_123", tx),
    ).rejects.toThrow("You can only access tasks assigned to your coworker");
  });

  it("allows a delegated coworker to read an unassigned task when the route opts in", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
      delegation: {
        userId: "user_delegate",
        organizationId: "org_123",
      },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    // In the delegated user's workspace, assigned to a different coworker.
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      coworkerId: "cow_other",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    const task = await requireTaskReadForRouteVars(vars, "tsk_123", tx, {
      unassignedDelegateGrant: CoworkerGrantScope.TASK_READ,
    });

    expect(task).toMatchObject({ id: "tsk_123", coworkerId: "cow_other" });
    expect(requireCoworkerGrantMock).toHaveBeenCalledWith(
      "cow_123",
      "user_delegate",
      CoworkerGrantScope.TASK_READ,
      tx,
    );
  });
});

describe("requireCoworkerTaskCollaboration", () => {
  it("loads non-draft tasks assigned to the coworker", async () => {
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

    await requireCoworkerTaskCollaboration(coworkerContext, "tsk_123", tx);

    expect(tx.task.findFirst).not.toHaveBeenCalled();
    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        status: { not: TaskStatus.DRAFT },
        awaitingAcceptance: false,
        archivedAt: null,
      },
    });
  });

  it("rejects when tasks capability is unavailable", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireCoworkerTaskCollaboration(coworkerContext, "tsk_123", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");

    expect(tx.task.findUnique).not.toHaveBeenCalled();
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

describe("requireJobRead", () => {
  it("uses workspace-scoped job reads", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireJobRead(jobReadWorkspaceContext, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        workspaceId,
      },
    });
  });

  it("returns not found when workspace id is empty and no job matches", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobRead(
        { workspaceId: "", userId: null, organizationId: null },
        "job_123",
        tx,
      ),
    ).rejects.toThrow("Job not found");

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_123", workspaceId: "" },
    });
  });

  it("returns not found when job is not in the workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobRead(jobReadWorkspaceContext, "job_123", tx),
    ).rejects.toThrow("Job not found");
  });
});

describe("requireJobOwnership", () => {
  it("allows only owned jobs", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireJobOwnership(sessionUserContext, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        userId: "user_123",
      },
    });
  });

  it("rejects jobs that are not owned by the current user", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobOwnership(sessionUserContext, "job_123", tx),
    ).rejects.toThrow("You can only access your own jobs");
  });
});

const delegatedCoworkerContext: CoworkerAuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  delegation: {
    userId: "user_delegate",
    organizationId: "org_123",
  },
};

describe("resolveConversationCoworkerId", () => {
  it("prefers the stable coworker_id without a DB lookup", async () => {
    const tx = createTransactionClient();

    const result = await resolveConversationCoworkerId(
      { coworker_id: "cow_123", coworker_slug: "ops-agent" },
      tx,
    );

    expect(result).toBe("cow_123");
    expect(tx.coworker.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to resolving coworker_slug to an id", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
    } as never);

    const result = await resolveConversationCoworkerId(
      { coworker_slug: "ops-agent" },
      tx,
    );

    expect(result).toBe("cow_123");
    expect(tx.coworker.findFirst).toHaveBeenCalledWith({
      where: { slug: "ops-agent", archivedAt: null },
      select: { id: true },
    });
  });

  it("returns null when there is no coworker binding", async () => {
    const tx = createTransactionClient();

    expect(await resolveConversationCoworkerId(null, tx)).toBeNull();
    expect(await resolveConversationCoworkerId({ userId: "u" }, tx)).toBeNull();
  });

  it("returns null when the slug resolves to no coworker", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    expect(
      await resolveConversationCoworkerId({ coworker_slug: "ghost" }, tx),
    ).toBeNull();
  });
});

describe("requireConversationCoworkerAccess", () => {
  it("is a no-op for user sessions", async () => {
    const tx = createTransactionClient();

    await requireConversationCoworkerAccess(userAuthContext, null, tx);

    expect(tx.coworker.findFirst).not.toHaveBeenCalled();
  });

  it("allows a delegated coworker on its own conversation (coworker_id)", async () => {
    const tx = createTransactionClient();

    await requireConversationCoworkerAccess(
      delegatedCoworkerContext,
      { coworker_id: "cow_123" },
      tx,
    );

    expect(tx.coworker.findFirst).not.toHaveBeenCalled();
  });

  it("allows a delegated coworker when only coworker_slug is set", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
    } as never);

    await requireConversationCoworkerAccess(
      delegatedCoworkerContext,
      { coworker_slug: "ops-agent" },
      tx,
    );

    expect(tx.coworker.findFirst).toHaveBeenCalled();
  });

  it("rejects a delegated coworker on another coworker's conversation", async () => {
    const tx = createTransactionClient();

    await expect(
      requireConversationCoworkerAccess(
        delegatedCoworkerContext,
        { coworker_id: "cow_other" },
        tx,
      ),
    ).rejects.toThrow(
      "You can only access conversations assigned to your coworker",
    );
  });

  it("rejects a delegated coworker on a conversation with no binding", async () => {
    const tx = createTransactionClient();

    await expect(
      requireConversationCoworkerAccess(
        delegatedCoworkerContext,
        { userId: "delegated_user_123" },
        tx,
      ),
    ).rejects.toThrow(
      "You can only access conversations assigned to your coworker",
    );
  });

  it("rejects a coworker without delegation", async () => {
    const tx = createTransactionClient();
    const coworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
    };

    await expect(
      requireConversationCoworkerAccess(
        coworkerContext,
        { coworker_id: "cow_123" },
        tx,
      ),
    ).rejects.toThrow("Delegation is required for this resource");
  });
});

describe("requireJobReadForRouteVars", () => {
  it("delegates to workspace read for users", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireJobReadForRouteVars(vars, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_123", workspaceId },
    });
    expect(tx.coworker.findFirst).not.toHaveBeenCalled();
  });

  it("returns not found for a user when the job is not in the workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireJobReadForRouteVars(vars, "job_123", tx),
    ).rejects.toThrow("Job not found");
  });

  it("allows a delegated coworker to read a job assigned to it", async () => {
    const tx = createTransactionClient();

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      coworkerId: "cow_123",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: delegatedCoworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireJobReadForRouteVars(vars, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_123", workspaceId },
    });
    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: { id: "tsk_123" },
      select: { coworkerId: true },
    });
  });

  it("rejects a delegated coworker reading a job assigned to another coworker", async () => {
    const tx = createTransactionClient();

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      coworkerId: "cow_other",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: delegatedCoworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireJobReadForRouteVars(vars, "job_123", tx),
    ).rejects.toThrow("You can only access jobs assigned to your coworker");
  });

  it("rejects a delegated coworker reading a job with no task", async () => {
    const tx = createTransactionClient();

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: null,
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: delegatedCoworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireJobReadForRouteVars(vars, "job_123", tx),
    ).rejects.toThrow("You can only access jobs assigned to your coworker");

    expect(tx.task.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a delegated coworker without tasks capability before loading the job", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: delegatedCoworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireJobReadForRouteVars(vars, "job_123", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");

    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a bare coworker without delegation", async () => {
    const tx = createTransactionClient();
    const bareCoworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
    };

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: bareCoworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireJobReadForRouteVars(vars, "job_123", tx),
    ).rejects.toThrow("Delegation headers");

    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });
});

describe("requireJobCollaboration", () => {
  it("uses ownership for users", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireJobCollaboration(userAuthContext, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_123", userId: "user_123" },
    });
  });

  it("rejects users that do not own the job", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobCollaboration(userAuthContext, "job_123", tx),
    ).rejects.toThrow("You can only access your own jobs");
  });

  it("allows a delegated coworker to act on a job assigned to it", async () => {
    const tx = createTransactionClient();

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      coworkerId: "cow_123",
    } as never);

    await requireJobCollaboration(delegatedCoworkerContext, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_123", userId: "user_delegate" },
    });
    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: { id: "tsk_123" },
      select: { coworkerId: true },
    });
  });

  it("rejects a delegated coworker acting on a job assigned to another coworker", async () => {
    const tx = createTransactionClient();

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      coworkerId: "cow_other",
    } as never);

    await expect(
      requireJobCollaboration(delegatedCoworkerContext, "job_123", tx),
    ).rejects.toThrow("You can only access jobs assigned to your coworker");
  });

  it("rejects a delegated coworker without tasks capability before loading the job", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobCollaboration(delegatedCoworkerContext, "job_123", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");

    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a bare coworker without delegation", async () => {
    const tx = createTransactionClient();
    const bareCoworkerContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
    };

    await expect(
      requireJobCollaboration(bareCoworkerContext, "job_123", tx),
    ).rejects.toThrow("Delegation headers");

    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });
});
