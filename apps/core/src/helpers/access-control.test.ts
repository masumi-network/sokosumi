import {
  CoworkerWorkspaceAccessStatus,
  MemberRole,
  type Prisma,
  TaskStatus,
  TaskVisibility,
  VendorGrantStatus,
} from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";
import type {
  CoworkerAuthenticationContext,
  SokoBotAuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import {
  buildCoworkerUsableInWorkspaceWhere,
  requireCoworkerCapability,
  requireCoworkerChatCapabilityInWorkspace,
  requireCoworkerTaskCollaboration,
  requireJobCollaboration,
  requireJobOwnership,
  requireJobRead,
  requireJobReadForRouteVars,
  requireMutableTaskOwnership,
  requireTaskArchiveAccess,
  requireTaskAssignableCoworker,
  requireTaskAssignableSokoBot,
  requireTaskAssignableUser,
  requireTaskCancelAccess,
  requireTaskCollaboration,
  requireTaskCommentAccess,
  requireTaskOwnership,
  requireTaskReadForRouteVars,
  requireTaskReadForWorkspace,
  requireTaskStatusWriteAccess,
  requireTaskWorkspaceMapping,
} from "./access-control";
import { buildHumanTaskVisibilityWhere } from "./task-visibility";
import { buildCoworkerAuthorizedTaskWhere } from "./vendor-siblings";

const {
  getWorkspaceGrantMock,
  requestWorkspaceGrantMock,
  resolveMemberOrganizationByIdMock,
  prismaTransactionMock,
  independentGrantTxClient,
} = vi.hoisted(() => {
  const independentGrantTxClient = {
    label: "independent-grant-tx",
  } as unknown as Prisma.TransactionClient;

  return {
    getWorkspaceGrantMock: vi.fn(),
    requestWorkspaceGrantMock: vi.fn(),
    resolveMemberOrganizationByIdMock: vi.fn(),
    independentGrantTxClient,
    prismaTransactionMock: vi.fn(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(independentGrantTxClient),
    ),
  };
});

vi.mock("./vendor-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vendor-grants")>();

  return {
    ...actual,
    getWorkspaceGrant: getWorkspaceGrantMock,
    requestWorkspaceGrantCommitted: async (
      params: Parameters<typeof requestWorkspaceGrantMock>[0],
    ) =>
      prismaTransactionMock(async (grantTx: Prisma.TransactionClient) =>
        requestWorkspaceGrantMock(params, grantTx),
      ),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("./organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

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
    workspace: {
      findUnique: vi.fn(),
    },
    member: {
      findFirst: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient;
}

const userAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const sessionUserContext = { source: "session" as const, ...userAuthContext };

const defaultVendorId = "01960001-0001-7001-8001-000000000001";

function createCoworkerContext(
  coworkerId: string,
  context?: CoworkerAuthenticationContext["context"],
): CoworkerAuthenticationContext {
  return {
    actor: "coworker",
    coworkerId,
    vendorId: defaultVendorId,
    ...(context ? { context } : {}),
  };
}

const workspaceId = "11111111-1111-7111-8111-111111111111";
const sokoBotAuthContext: SokoBotAuthenticationContext = {
  actor: "sokoBot",
  sokoBotId: "22222222-2222-7222-8222-222222222222",
  userId: "user_123",
  workspaceId,
  organizationId: "org_123",
};

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
        ownerId: "user_123",
        archivedAt: null,
      },
    });
  });
});

describe("requireMutableTaskOwnership", () => {
  it("rejects parked tasks", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      status: TaskStatus.GRANT_PENDING,
    } as never);

    await expect(
      requireMutableTaskOwnership(sessionUserContext, "tsk_123", tx),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).cause).toMatchObject({
        kind: "task_parked",
      });
      return true;
    });
  });

  it("allows non-parked owned tasks", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      pendingVendorGrantId: null,
    } as never);

    await expect(
      requireMutableTaskOwnership(sessionUserContext, "tsk_123", tx),
    ).resolves.toMatchObject({ id: "tsk_123" });
  });
});

function archiveAccessVars(
  workspaceContext: WorkspaceContext | null = jobReadWorkspaceContext,
  authContext: UserAuthenticationContext = userAuthContext,
): EnvVariables["Variables"] {
  return {
    isAuthenticated: true,
    authContext,
    workspaceContext,
  };
}

describe("requireTaskArchiveAccess", () => {
  beforeEach(() => {
    resolveMemberOrganizationByIdMock.mockReset();
  });

  it("allows the task owner including parked tasks", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      pendingVendorGrantId: "grant_1",
      ownerId: "user_123",
    } as never);

    await expect(
      requireTaskArchiveAccess(archiveAccessVars(), "tsk_123", tx),
    ).resolves.toMatchObject({ id: "tsk_123" });
  });

  it("allows org owner/admin to archive parked tasks they do not own", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_parked",
        status: TaskStatus.GRANT_PENDING,
        ownerId: "user_other",
        visibility: TaskVisibility.PUBLIC,
        workspace: { organizationId: "org_123" },
      } as never);

    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: "org_123" });

    await expect(
      requireTaskArchiveAccess(archiveAccessVars(), "tsk_parked", tx),
    ).resolves.toMatchObject({ id: "tsk_parked" });

    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org_123",
        userId: "user_123",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
  });

  it("hides private parked tasks from org owner/admin non-owners", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_parked_private",
        status: TaskStatus.GRANT_PENDING,
        ownerId: "user_other",
        visibility: TaskVisibility.PRIVATE,
        workspace: { organizationId: "org_123" },
      } as never);

    await expect(
      requireTaskArchiveAccess(archiveAccessVars(), "tsk_parked_private", tx),
    ).rejects.toMatchObject({
      status: 404,
      message: "Task not found",
    });
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("rejects a non-owner who is not org OWNER/ADMIN on a parked task", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_parked",
        status: TaskStatus.GRANT_PENDING,
        ownerId: "user_other",
        visibility: TaskVisibility.PUBLIC,
        workspace: { organizationId: "org_123" },
      } as never);

    resolveMemberOrganizationByIdMock.mockRejectedValue(
      new HTTPException(404, { message: "Organization not found" }),
    );

    await expect(
      requireTaskArchiveAccess(archiveAccessVars(), "tsk_parked", tx),
    ).rejects.toMatchObject({ status: 404 });

    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org_123",
        userId: "user_123",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
  });

  it("rejects when task is missing", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      requireTaskArchiveAccess(archiveAccessVars(), "tsk_123", tx),
    ).rejects.toThrow("Task not found");
  });

  it("lets the owner archive a Task created by a Task Schedule", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_from_schedule",
      status: TaskStatus.QUEUED,
      ownerId: "user_123",
      scheduleId: "sch_123",
      runAt: new Date("2026-08-01T10:00:00.000Z"),
    } as never);

    await expect(
      requireTaskArchiveAccess(archiveAccessVars(), "tsk_from_schedule", tx),
    ).resolves.toMatchObject({ id: "tsk_from_schedule" });

    expect(tx.task.findFirst).toHaveBeenCalledTimes(1);
  });

  it("rejects org members for a Task created by a Task Schedule they do not own", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_from_schedule",
        status: TaskStatus.QUEUED,
        ownerId: "user_other",
        visibility: TaskVisibility.PUBLIC,
        scheduleId: "sch_123",
        runAt: new Date("2026-08-01T10:00:00.000Z"),
        workspace: { organizationId: "org_123" },
      } as never);

    await expect(
      requireTaskArchiveAccess(archiveAccessVars(), "tsk_from_schedule", tx),
    ).rejects.toMatchObject({ status: 404, message: "Task not found" });

    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("rejects org members for tasks they do not own", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_plain",
        status: TaskStatus.READY,
        ownerId: "user_other",
        workspace: { organizationId: "org_123" },
      } as never);

    await expect(
      requireTaskArchiveAccess(archiveAccessVars(), "tsk_plain", tx),
    ).rejects.toThrow("Task not found");

    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("rejects non-owners for tasks in a personal workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_personal",
        status: TaskStatus.GRANT_PENDING,
        ownerId: "user_other",
        visibility: TaskVisibility.PUBLIC,
        workspace: { organizationId: null },
      } as never);

    await expect(
      requireTaskArchiveAccess(archiveAccessVars(), "tsk_personal", tx),
    ).rejects.toThrow("Task not found");

    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
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
        ownerId: "user_123",
        archivedAt: null,
      },
    });
  });

  it("uses coworker task access for coworkers", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findUnique).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeId: "cow_123",
      status: TaskStatus.READY,
    } as never);

    await requireTaskCollaboration(coworkerContext, "tsk_123", tx);

    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        status: { not: TaskStatus.DRAFT },
        archivedAt: null,
      },
    });
  });

  it("allows a soko bot only on its assigned task in its workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      status: TaskStatus.READY,
      assigneeSokoBotId: sokoBotAuthContext.sokoBotId,
    } as never);

    await requireTaskCollaboration(sokoBotAuthContext, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        workspaceId,
        assigneeSokoBotId: sokoBotAuthContext.sokoBotId,
        status: { not: TaskStatus.DRAFT },
        archivedAt: null,
        ...buildHumanTaskVisibilityWhere(sokoBotAuthContext.userId),
      },
    });
  });

  it("rejects coworkers without tasks capability before loading the task", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireTaskCollaboration(coworkerContext, "tsk_123", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");

    expect(tx.task.findUnique).not.toHaveBeenCalled();
  });

  it("rejects delegated coworkers without tasks capability before loading the task", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireTaskCollaboration(coworkerContext, "tsk_123", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");

    expect(tx.task.findFirst).not.toHaveBeenCalled();
    expect(tx.task.findUnique).not.toHaveBeenCalled();
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
      ownerId: "user_123",
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
        ...buildHumanTaskVisibilityWhere("user_123"),
      },
    });
  });

  it("returns not found for another member's private task", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(null);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_private", tx),
    ).rejects.toThrow("Task not found");

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_private",
        archivedAt: null,
        workspaceId,
        ...buildHumanTaskVisibilityWhere("user_123"),
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

  it("reads only the soko bot's assigned task", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeSokoBotId: sokoBotAuthContext.sokoBotId,
    } as never);
    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: sokoBotAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskReadForRouteVars(vars, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        workspaceId,
        assigneeSokoBotId: sokoBotAuthContext.sokoBotId,
        status: { not: TaskStatus.DRAFT },
        archivedAt: null,
        ...buildHumanTaskVisibilityWhere(sokoBotAuthContext.userId),
      },
    });
  });

  it("delegates to coworker read for coworkers", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeId: "cow_123",
      status: TaskStatus.READY,
      assignee: { vendorId: defaultVendorId },
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: null,
    };

    await requireTaskReadForRouteVars(vars, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: buildCoworkerAuthorizedTaskWhere({
        taskId: "tsk_123",
        coworkerId: "cow_123",
        vendorId: defaultVendorId,
      }),
    });
    expect(tx.task.findUnique).not.toHaveBeenCalled();
  });

  it("delegates coworker reads with delegation to workspace read", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeId: "cow_123",
      status: TaskStatus.READY,
      assignee: { vendorId: defaultVendorId },
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskReadForRouteVars(vars, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: buildCoworkerAuthorizedTaskWhere({
        taskId: "tsk_123",
        coworkerId: "cow_123",
        vendorId: defaultVendorId,
        workspaceId,
      }),
    });
    expect(tx.coworker.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
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

  it("rejects coworker reads of draft assignee tasks", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(null);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: null,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_draft", tx),
    ).rejects.toThrow("Task not found");

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: buildCoworkerAuthorizedTaskWhere({
        taskId: "tsk_draft",
        coworkerId: "cow_123",
        vendorId: defaultVendorId,
      }),
    });
  });

  it("rejects delegated coworker reads without tasks capability before loading the task", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

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
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(null);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_123", tx),
    ).rejects.toThrow("Task not found");
  });

  it("allows a delegated coworker to read a same-vendor sibling task", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeId: "cow_other",
      status: TaskStatus.READY,
      assignee: { vendorId: defaultVendorId },
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskReadForRouteVars(vars, "tsk_123", tx);
  });
});

describe("requireTaskWorkspaceMapping", () => {
  beforeEach(() => {
    resolveMemberOrganizationByIdMock.mockReset();
  });

  it("maps a task in another workspace when the session user is an org member", async () => {
    const tx = createTransactionClient();
    const otherWorkspaceId = "22222222-2222-7222-8222-222222222222";
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      name: "Quarterly report",
      ownerId: "user_owner",
      workspaceId: otherWorkspaceId,
      workspace: { organizationId: "org_other" },
    } as never);
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: "org_other" });

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskWorkspaceMapping(vars, "tsk_other", tx),
    ).resolves.toMatchObject({
      name: "Quarterly report",
      workspaceId: otherWorkspaceId,
      workspace: { organizationId: "org_other" },
    });

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      select: {
        name: true,
        ownerId: true,
        workspaceId: true,
        workspace: { select: { organizationId: true } },
      },
      where: {
        id: "tsk_other",
        archivedAt: null,
        ...buildHumanTaskVisibilityWhere("user_123"),
      },
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_other",
      userId: "user_123",
      tx,
    });
  });

  it("allows the personal-workspace owner without an organization", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      name: "Personal task",
      ownerId: "user_123",
      workspaceId,
      workspace: { organizationId: null },
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: {
        ...userAuthContext,
        organizationId: null,
      },
      workspaceContext: {
        workspaceId,
        userId: "user_123",
        organizationId: null,
      },
    };

    await expect(
      requireTaskWorkspaceMapping(vars, "tsk_personal", tx),
    ).resolves.toMatchObject({
      name: "Personal task",
      workspace: { organizationId: null },
    });
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("omits another member's private task as not found", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(null);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskWorkspaceMapping(vars, "tsk_private", tx),
    ).rejects.toThrow("Task not found");

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      select: {
        name: true,
        ownerId: true,
        workspaceId: true,
        workspace: { select: { organizationId: true } },
      },
      where: {
        id: "tsk_private",
        archivedAt: null,
        ...buildHumanTaskVisibilityWhere("user_123"),
      },
    });
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("rejects a personal-workspace mapping for a non-owner", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      name: "Personal task",
      ownerId: "user_owner",
      workspaceId,
      workspace: { organizationId: null },
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskWorkspaceMapping(vars, "tsk_personal", tx),
    ).rejects.toThrow("You do not have access to this task");
  });

  it("keeps coworker mapping on the assigned-task read gate", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_123",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(null);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskWorkspaceMapping(vars, "tsk_other", tx),
    ).rejects.toThrow("Task not found");

    expect(tx.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "tsk_other",
          workspaceId,
        }),
      }),
    );
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });
});

describe("requireTaskCommentAccess", () => {
  beforeEach(() => {
    getWorkspaceGrantMock.mockReset();
    requestWorkspaceGrantMock.mockReset();
    prismaTransactionMock.mockClear();
  });

  it("allows a bare coworker to comment on a same-vendor sibling task", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");
    const siblingTask = {
      id: "tsk_123",
      assigneeId: "cow_other",
      status: TaskStatus.READY,
      assignee: { vendorId: defaultVendorId },
      pendingVendorGrantId: null,
      workspaceId,
      workspace: { organizationId: "org_123" },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(siblingTask as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: null,
    };

    await requireTaskCommentAccess(vars, "tsk_123", tx);
  });

  it("allows a session user to comment on a workspace-visible task they do not own", async () => {
    const tx = createTransactionClient();
    const memberAuthContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_member",
      organizationId: "org_123",
      role: "user",
    };

    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      ownerId: "user_owner",
      pendingVendorGrantId: null,
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: memberAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskCommentAccess(vars, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId,
        ...buildHumanTaskVisibilityWhere("user_member"),
      },
    });
  });

  it("allows a delegated coworker to comment on a same-vendor sibling task", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });
    const siblingTask = {
      id: "tsk_123",
      assigneeId: "cow_other",
      status: TaskStatus.READY,
      assignee: { vendorId: defaultVendorId },
      pendingVendorGrantId: null,
      workspaceId,
      workspace: { organizationId: "org_123" },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(siblingTask as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskCommentAccess(vars, "tsk_123", tx);
  });

  it("requests PENDING workspace grant when commenting beyond baseline", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_123",
        assigneeId: "cow_foreign",
        status: TaskStatus.READY,
        pendingVendorGrantId: null,
      } as never);
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      organizationId: "org_123",
    } as never);
    getWorkspaceGrantMock.mockResolvedValue(null);
    requestWorkspaceGrantMock.mockResolvedValue({
      grant: { id: "workspace-grant", status: VendorGrantStatus.PENDING },
      created: true,
    });

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskCommentAccess(vars, "tsk_123", tx),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).cause).toMatchObject({
        kind: "grant_required",
        extensions: { permission: "workspace" },
      });
      return true;
    });

    expect(prismaTransactionMock).toHaveBeenCalledTimes(1);
    expect(requestWorkspaceGrantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: defaultVendorId,
        workspaceId,
      }),
      independentGrantTxClient,
    );
  });

  it("allows comment when grant becomes GRANTED during independent request", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });
    const foreignVendorId = "01960001-0002-7001-8001-000000000002";
    const foreignTask = {
      id: "tsk_123",
      assigneeId: "cow_foreign",
      status: TaskStatus.READY,
      pendingVendorGrantId: null,
      workspaceId,
      assignee: { vendorId: foreignVendorId },
      workspace: { organizationId: "org_123" },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(foreignTask as never);
    getWorkspaceGrantMock.mockResolvedValue({
      id: "workspace-grant",
      status: VendorGrantStatus.PENDING,
    });
    requestWorkspaceGrantMock.mockResolvedValue({
      grant: { id: "workspace-grant", status: VendorGrantStatus.GRANTED },
      created: false,
    });

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskCommentAccess(vars, "tsk_123", tx),
    ).resolves.toMatchObject({ id: "tsk_123" });
  });

  it("does not open PENDING when sibling baseline already allows comment", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });
    const siblingTask = {
      id: "tsk_123",
      assigneeId: "cow_other",
      status: TaskStatus.READY,
      assignee: { vendorId: defaultVendorId },
      pendingVendorGrantId: null,
      workspaceId,
      workspace: { organizationId: "org_123" },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce(siblingTask as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskCommentAccess(vars, "tsk_123", tx);

    expect(requestWorkspaceGrantMock).not.toHaveBeenCalled();
    expect(getWorkspaceGrantMock).not.toHaveBeenCalled();
  });
});

describe("requireTaskCancelAccess", () => {
  it("allows the task owner to cancel", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      ownerId: "user_123",
      pendingVendorGrantId: null,
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskCancelAccess(vars, "tsk_123", tx);

    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId,
        ...buildHumanTaskVisibilityWhere("user_123"),
      },
    });
  });

  it("allows an org workspace member who does not own the task to cancel", async () => {
    const tx = createTransactionClient();
    const memberAuthContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_member",
      organizationId: "org_123",
      role: "user",
    };

    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      ownerId: "user_owner",
      pendingVendorGrantId: null,
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: memberAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskCancelAccess(vars, "tsk_123", tx);
  });

  it("rejects a personal-workspace non-owner", async () => {
    const tx = createTransactionClient();
    const personalWorkspace: WorkspaceContext = {
      workspaceId,
      userId: "user_member",
      organizationId: null,
    };
    const memberAuthContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_member",
      organizationId: null,
      role: "user",
    };

    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      ownerId: "user_owner",
      pendingVendorGrantId: null,
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: memberAuthContext,
      workspaceContext: personalWorkspace,
    };

    await expect(requireTaskCancelAccess(vars, "tsk_123", tx)).rejects.toThrow(
      "Task not found",
    );
  });

  it("uses coworker collaboration for coworker actors", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findUnique).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeId: "cow_123",
      status: TaskStatus.READY,
      pendingVendorGrantId: null,
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: null,
    };

    await requireTaskCancelAccess(vars, "tsk_123", tx);

    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        status: { not: TaskStatus.DRAFT },
        archivedAt: null,
      },
    });
  });

  it("rejects cancel while the task is parked", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      ownerId: "user_123",
      status: TaskStatus.GRANT_PENDING,
      pendingVendorGrantId: "grant_1",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: userAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskCancelAccess(vars, "tsk_123", tx),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).cause).toMatchObject({
        kind: "task_parked",
      });
      return true;
    });
  });
});

describe("requireTaskStatusWriteAccess", () => {
  const orgMemberAuthContext: UserAuthenticationContext = {
    actor: "user",
    userId: "user_member",
    organizationId: "org_123",
    role: "user",
  };

  function varsFor(
    authContext: UserAuthenticationContext,
    workspaceContext: WorkspaceContext = jobReadWorkspaceContext,
  ): EnvVariables["Variables"] {
    return {
      isAuthenticated: true,
      authContext,
      workspaceContext,
    };
  }

  it("lets an org member write a human-assigned task (routing, not a lock)", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_owner",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: "user_assignee",
      pendingVendorGrantId: null,
    } as never);

    await requireTaskStatusWriteAccess(
      varsFor(orgMemberAuthContext),
      "tsk_123",
      tx,
    );
  });

  it("lets an org member write an unset task", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_owner",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      pendingVendorGrantId: null,
    } as never);

    await requireTaskStatusWriteAccess(
      varsFor(orgMemberAuthContext),
      "tsk_123",
      tx,
    );
  });

  it("rejects a personal-workspace non-owner on human tasks", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_owner",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: "user_assignee",
      pendingVendorGrantId: null,
    } as never);

    const personalWorkspace: WorkspaceContext = {
      workspaceId,
      userId: "user_member",
      organizationId: null,
    };
    const personalAuthContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_member",
      organizationId: null,
      role: "user",
    };

    await expect(
      requireTaskStatusWriteAccess(
        varsFor(personalAuthContext, personalWorkspace),
        "tsk_123",
        tx,
      ),
    ).rejects.toThrow("Task not found");
  });

  it("keeps agent-assigned tasks on owner-only collaboration", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockImplementation(((args: {
      where: { ownerId?: string };
    }) =>
      Promise.resolve(
        args.where.ownerId === undefined || args.where.ownerId === "user_123"
          ? ({
              id: "tsk_123",
              ownerId: "user_123",
              assigneeId: "cow_123",
              assigneeSokoBotId: null,
              assigneeUserId: null,
              pendingVendorGrantId: null,
            } as never)
          : null,
      )) as never);

    // Non-owner org member is denied on a coworker-assigned task.
    await expect(
      requireTaskStatusWriteAccess(
        varsFor(orgMemberAuthContext),
        "tsk_123",
        tx,
      ),
    ).rejects.toThrow("Task not found");

    // Owner is allowed.
    await requireTaskStatusWriteAccess(varsFor(userAuthContext), "tsk_123", tx);
  });
});

describe("requireTaskReadForRouteVars vendor grants", () => {
  beforeEach(() => {
    getWorkspaceGrantMock.mockReset();
    requestWorkspaceGrantMock.mockReset();
    prismaTransactionMock.mockClear();
  });

  it("requests PENDING workspace grant on first out-of-scope read", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_foreign",
        assigneeId: "cow_foreign",
        status: TaskStatus.READY,
      } as never);
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      organizationId: "org_123",
    } as never);
    getWorkspaceGrantMock.mockResolvedValue(null);
    requestWorkspaceGrantMock.mockResolvedValue({
      grant: { id: "workspace-grant", status: VendorGrantStatus.PENDING },
      created: true,
    });

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_foreign", tx),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).cause).toMatchObject({
        kind: "grant_required",
        extensions: { permission: "workspace" },
      });
      return true;
    });

    expect(prismaTransactionMock).toHaveBeenCalledTimes(1);
    expect(requestWorkspaceGrantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: defaultVendorId,
        workspaceId,
      }),
      independentGrantTxClient,
    );
  });

  it("allows out-of-scope read when grant becomes GRANTED during independent request", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_foreign",
        assigneeId: "cow_foreign",
        status: TaskStatus.READY,
      } as never);
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      organizationId: "org_123",
    } as never);
    getWorkspaceGrantMock.mockResolvedValue({
      id: "workspace-grant",
      status: VendorGrantStatus.PENDING,
    });
    requestWorkspaceGrantMock.mockResolvedValue({
      grant: { id: "workspace-grant", status: VendorGrantStatus.GRANTED },
      created: false,
    });

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_foreign", tx),
    ).resolves.toMatchObject({ id: "tsk_foreign" });
  });

  it("allows out-of-scope read when workspace access is GRANTED", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_foreign",
        assigneeId: "cow_foreign",
        status: TaskStatus.READY,
      } as never);
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      organizationId: "org_123",
    } as never);
    getWorkspaceGrantMock.mockResolvedValue({
      id: "workspace-grant",
      status: VendorGrantStatus.GRANTED,
      permission: "workspace",
    });

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_foreign", tx),
    ).resolves.toMatchObject({ id: "tsk_foreign" });
    expect(requestWorkspaceGrantMock).not.toHaveBeenCalled();
  });

  it("does not reopen DENIED workspace grant", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_foreign",
        assigneeId: "cow_foreign",
        status: TaskStatus.READY,
      } as never);
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      organizationId: "org_123",
    } as never);
    getWorkspaceGrantMock.mockResolvedValue({
      id: "workspace-grant",
      status: VendorGrantStatus.DENIED,
      permission: "workspace",
    });

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireTaskReadForRouteVars(vars, "tsk_foreign", tx),
    ).rejects.toSatisfy((error: unknown) => {
      expect((error as HTTPException).cause).toMatchObject({
        kind: "grant_denied",
      });
      return true;
    });
    expect(requestWorkspaceGrantMock).not.toHaveBeenCalled();
  });
});

describe("requireTaskCollaboration sibling writes", () => {
  it("rejects a delegated coworker collaborating on a sibling task", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      ownerId: "user_delegate",
      assigneeId: "cow_other",
      status: TaskStatus.READY,
    } as never);

    await expect(
      requireTaskCollaboration(coworkerContext, "tsk_123", tx),
    ).rejects.toThrow("You can only act on tasks assigned to your coworker");
  });
});

describe("requireCoworkerTaskCollaboration", () => {
  it("loads non-draft tasks assigned to the coworker", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findUnique).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeId: "cow_123",
      status: TaskStatus.READY,
    } as never);

    await requireCoworkerTaskCollaboration(coworkerContext, "tsk_123", tx);

    expect(tx.task.findFirst).not.toHaveBeenCalled();
    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        status: { not: TaskStatus.DRAFT },
        archivedAt: null,
      },
    });
  });

  it("rejects when tasks capability is unavailable", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireCoworkerTaskCollaboration(coworkerContext, "tsk_123", tx),
    ).rejects.toThrow("Coworker is not allowed to use tasks");

    expect(tx.task.findUnique).not.toHaveBeenCalled();
  });
});

describe("buildCoworkerUsableInWorkspaceWhere", () => {
  it("allows global whitelist or GRANTED workspace access", () => {
    expect(buildCoworkerUsableInWorkspaceWhere(workspaceId)).toEqual({
      archivedAt: null,
      OR: [
        { isWhitelisted: true },
        {
          workspaceAccess: {
            some: {
              workspaceId,
              status: CoworkerWorkspaceAccessStatus.GRANTED,
            },
          },
        },
      ],
    });
  });
});

const usableInWorkspaceWhere = {
  ...buildCoworkerUsableInWorkspaceWhere(workspaceId),
  capabilities: {
    has: "tasks" as const,
  },
};

describe("requireTaskAssignableCoworker", () => {
  it("accepts whitelisted active coworkers with tasks capability", async () => {
    const tx = {
      coworker: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cow_123",
          slug: "ops-agent",
          baseURL: null,
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await requireTaskAssignableCoworker("cow_123", workspaceId, tx);

    expect(tx.coworker.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        ...usableInWorkspaceWhere,
      },
      select: {
        id: true,
        slug: true,
        baseURL: true,
      },
    });
  });

  it("accepts non-whitelisted coworkers with GRANTED workspace access", async () => {
    const tx = {
      coworker: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cow_123",
          slug: "pilot-agent",
          baseURL: null,
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await requireTaskAssignableCoworker("cow_123", workspaceId, tx);

    expect(tx.coworker.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        ...usableInWorkspaceWhere,
      },
      select: {
        id: true,
        slug: true,
        baseURL: true,
      },
    });
  });

  it("does not special-case leftover personal-assistant coworker rows", async () => {
    const sokoBotFindFirst = vi.fn();
    const tx = {
      coworker: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cow_123",
          slug: "ops-agent",
          baseURL: null,
        }),
      },
      sokoBot: { findFirst: sokoBotFindFirst },
    } as unknown as Prisma.TransactionClient;

    await requireTaskAssignableCoworker("cow_123", workspaceId, tx, {
      kind: "user",
      userId: "user_1",
    });

    expect(sokoBotFindFirst).not.toHaveBeenCalled();
  });

  it("rejects when no usable coworker matches (PENDING/DENIED/REVOKED/wrong workspace/archived/no tasks)", async () => {
    const tx = {
      coworker: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireTaskAssignableCoworker("cow_123", workspaceId, tx),
    ).rejects.toThrow("Coworker is not usable in this workspace");
  });
});

describe("requireTaskAssignableSokoBot", () => {
  it("lets the owner assign work to their own Soko Bot", async () => {
    const tx = {
      sokoBot: {
        findFirst: vi.fn().mockResolvedValue({ id: "bot_1", userId: "user_1" }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireTaskAssignableSokoBot("bot_1", workspaceId, tx, {
        kind: "user",
        userId: "user_1",
      }),
    ).resolves.toBeUndefined();
  });

  it("lets the Soko Bot assign work to itself", async () => {
    const tx = {
      sokoBot: {
        findFirst: vi.fn().mockResolvedValue({ id: "bot_1", userId: "user_1" }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireTaskAssignableSokoBot("bot_1", workspaceId, tx, {
        kind: "soko_bot",
        sokoBotId: "bot_1",
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a teammate assigning work to someone else's Soko Bot", async () => {
    const tx = {
      sokoBot: {
        findFirst: vi.fn().mockResolvedValue({ id: "bot_1", userId: "owner" }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireTaskAssignableSokoBot("bot_1", workspaceId, tx, {
        kind: "user",
        userId: "teammate",
      }),
    ).rejects.toThrow("Only the owner can assign work to this Soko Bot");
  });

  it("rejects a missing or archived soko bot", async () => {
    const tx = {
      sokoBot: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireTaskAssignableSokoBot("bot_1", workspaceId, tx),
    ).rejects.toThrow("Soko Bot is not usable in this workspace");
  });
});

describe("requireTaskAssignableUser", () => {
  it("accepts the personal workspace owner", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      userId: "user_1",
      organizationId: null,
    } as never);

    await expect(
      requireTaskAssignableUser("user_1", workspaceId, tx),
    ).resolves.toBeUndefined();
    expect(tx.member.findFirst).not.toHaveBeenCalled();
  });

  it("accepts an organization member in an org workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      userId: "owner",
      organizationId: "org_1",
    } as never);
    vi.mocked(tx.member.findFirst).mockResolvedValue({ id: "m_1" } as never);

    await expect(
      requireTaskAssignableUser("user_1", workspaceId, tx),
    ).resolves.toBeUndefined();
    expect(tx.member.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_1", userId: "user_1" },
      select: { id: true },
    });
  });

  it("rejects a non-member in a personal workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      userId: "owner",
      organizationId: null,
    } as never);

    await expect(
      requireTaskAssignableUser("user_1", workspaceId, tx),
    ).rejects.toThrow("User is not a member of this workspace");
  });

  it("rejects an org outsider", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      userId: "owner",
      organizationId: "org_1",
    } as never);
    vi.mocked(tx.member.findFirst).mockResolvedValue(null);

    await expect(
      requireTaskAssignableUser("user_1", workspaceId, tx),
    ).rejects.toThrow("User is not a member of this workspace");
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

  it("passes for non-whitelisted active coworker with capability (actor path)", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "pilot-agent",
      baseURL: null,
    } as never);

    await requireCoworkerCapability("cow_123", "tasks", tx);

    expect(tx.coworker.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
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
});

describe("requireCoworkerChatCapabilityInWorkspace", () => {
  it("requires workspace usability, chat capability, and baseURL", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "https://responses.example.com/v1",
    } as never);

    await requireCoworkerChatCapabilityInWorkspace("cow_123", workspaceId, tx);

    expect(tx.coworker.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        ...buildCoworkerUsableInWorkspaceWhere(workspaceId),
        capabilities: {
          has: "chat",
        },
        AND: [{ baseURL: { not: null } }, { baseURL: { not: "" } }],
      },
      select: {
        id: true,
        slug: true,
        baseURL: true,
      },
    });
  });

  it("rejects when coworker is not usable in the workspace", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireCoworkerChatCapabilityInWorkspace("cow_123", workspaceId, tx),
    ).rejects.toThrow("Coworker chat is not available");
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

  it("hides jobs whose parent task is private to another member", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
    } as never);

    await requireJobRead(jobReadWorkspaceContext, "job_123", tx, "user_123");

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        workspaceId,
        OR: [
          { taskId: null },
          {
            task: {
              is: {
                OR: [
                  { visibility: TaskVisibility.PUBLIC },
                  {
                    visibility: TaskVisibility.PRIVATE,
                    ownerId: "user_123",
                  },
                ],
              },
            },
          },
        ],
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
        ownerId: "user_123",
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

const delegatedCoworkerContext = createCoworkerContext("cow_123", {
  userId: "user_delegate",
  organizationId: "org_123",
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
      where: {
        id: "job_123",
        workspaceId,
        OR: [
          { taskId: null },
          {
            task: {
              is: {
                OR: [
                  { visibility: TaskVisibility.PUBLIC },
                  {
                    visibility: TaskVisibility.PRIVATE,
                    ownerId: "user_123",
                  },
                ],
              },
            },
          },
        ],
      },
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

  it("allows a soko bot to read a job on its assigned task", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
      workspaceId,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeSokoBotId: sokoBotAuthContext.sokoBotId,
    } as never);
    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: sokoBotAuthContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireJobReadForRouteVars(vars, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_123", workspaceId },
    });
    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        workspaceId,
        assigneeSokoBotId: sokoBotAuthContext.sokoBotId,
        status: { not: TaskStatus.DRAFT },
        archivedAt: null,
        ...buildHumanTaskVisibilityWhere(sokoBotAuthContext.userId),
      },
    });
  });

  it("allows a delegated coworker to read a job assigned to it", async () => {
    const tx = createTransactionClient();
    const usableCoworker = {
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValue(usableCoworker as never);
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
      workspaceId,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeId: "cow_123",
      status: TaskStatus.READY,
      assignee: { vendorId: defaultVendorId },
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
      where: buildCoworkerAuthorizedTaskWhere({
        taskId: "tsk_123",
        coworkerId: "cow_123",
        vendorId: defaultVendorId,
        workspaceId,
      }),
    });
  });

  it("allows a delegated coworker to read a job on a same-vendor sibling task", async () => {
    const tx = createTransactionClient();

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
      workspaceId,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeId: "cow_other",
      status: TaskStatus.READY,
      assignee: { vendorId: defaultVendorId },
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: delegatedCoworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireJobReadForRouteVars(vars, "job_123", tx);
  });

  it("rejects a delegated coworker reading a cross-vendor sibling job", async () => {
    const tx = createTransactionClient();

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
      workspaceId,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(tx.workspace.findUnique).mockResolvedValue({
      organizationId: "org_123",
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: delegatedCoworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await expect(
      requireJobReadForRouteVars(vars, "job_123", tx),
    ).rejects.toThrow("Task not found");
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

  it("allows a bare coworker to read a job on a same-vendor sibling task", async () => {
    const tx = createTransactionClient();
    const bareCoworkerContext = createCoworkerContext("cow_123");

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
      workspaceId,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      assigneeId: "cow_other",
      status: TaskStatus.READY,
      assignee: { vendorId: defaultVendorId },
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: bareCoworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireJobReadForRouteVars(vars, "job_123", tx);
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
      where: { id: "job_123", ownerId: "user_123" },
    });
  });

  it("rejects users that do not own the job", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobCollaboration(userAuthContext, "job_123", tx),
    ).rejects.toThrow("You can only access your own jobs");
  });

  // SOK-1030 widened job *sharing* to any workspace member via
  // `requireJobShareCollaboration`. This helper still guards refund, workspace
  // move, metadata patch, and input submission, so it must stay owner-only.
  it("stays owner-only for a member of the same organization", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobCollaboration(
        { ...userAuthContext, userId: "member_456" },
        "job_of_another_member",
        tx,
      ),
    ).rejects.toThrow("You can only access your own jobs");

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_of_another_member", ownerId: "member_456" },
    });
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
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce({
        assigneeId: "cow_123",
      } as never)
      .mockResolvedValueOnce({
        pendingVendorGrantId: null,
      } as never);

    await requireJobCollaboration(delegatedCoworkerContext, "job_123", tx);

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_123", ownerId: "user_delegate" },
    });
    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: { id: "tsk_123" },
      select: { assigneeId: true },
    });
  });

  it("rejects job collaboration when the parent task is parked", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      status: TaskStatus.GRANT_PENDING,
    } as never);

    await expect(
      requireJobCollaboration(userAuthContext, "job_123", tx),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).cause).toMatchObject({
        kind: "task_parked",
      });
      return true;
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
      assigneeId: "cow_other",
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

  it("rejects a bare coworker without context headers", async () => {
    const tx = createTransactionClient();
    const bareCoworkerContext = createCoworkerContext("cow_123");

    await expect(
      requireJobCollaboration(bareCoworkerContext, "job_123", tx),
    ).rejects.toThrow("Context headers");

    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });
});

describe("buildCoworkerUsableInWorkspaceWhere", () => {
  it("does not treat personal assistants as usable coworkers", () => {
    const where = buildCoworkerUsableInWorkspaceWhere("workspace_1");

    expect(where.OR).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sokoBot: expect.anything(),
        }),
      ]),
    );
    expect(where.archivedAt).toBeNull();
  });
});
