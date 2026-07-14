import { MemberRole, type Prisma, VendorGrantStatus } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";
import type {
  CoworkerAuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import {
  requireConversationCoworkerAccess,
  requireCoworkerCapability,
  requireCoworkerChatCapability,
  requireCoworkerTaskCollaboration,
  requireJobCollaboration,
  requireJobOwnership,
  requireJobRead,
  requireJobReadForRouteVars,
  requireMutableTaskOwnership,
  requireTaskArchiveAccess,
  requireTaskAssignableCoworker,
  requireTaskCollaboration,
  requireTaskCommentAccess,
  requireTaskOwnership,
  requireTaskReadForRouteVars,
  requireTaskReadForWorkspace,
  resolveConversationCoworkerId,
} from "./access-control";
import { buildCoworkerAuthorizedTaskWhere } from "./vendor-siblings";

const {
  getWorkspaceGrantMock,
  requestWorkspaceGrantMock,
  resolveMemberOrganizationByIdMock,
} = vi.hoisted(() => ({
  getWorkspaceGrantMock: vi.fn(),
  requestWorkspaceGrantMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
}));

vi.mock("./vendor-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vendor-grants")>();

  return {
    ...actual,
    getWorkspaceGrant: getWorkspaceGrantMock,
    requestWorkspaceGrant: requestWorkspaceGrantMock,
  };
});

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

describe("requireMutableTaskOwnership", () => {
  it("rejects parked tasks", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      pendingVendorGrantId: "grant_1",
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

describe("requireTaskArchiveAccess", () => {
  it("allows the task owner including parked tasks", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      pendingVendorGrantId: "grant_1",
      userId: "user_123",
    } as never);

    await expect(
      requireTaskArchiveAccess(sessionUserContext, "tsk_123", tx),
    ).resolves.toMatchObject({ id: "tsk_123" });
  });

  it("allows org owner/admin to archive parked tasks they do not own", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_parked",
        pendingVendorGrantId: "grant_1",
        userId: "user_other",
        workspace: { organizationId: "org_123" },
      } as never);

    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: "org_123" });

    await expect(
      requireTaskArchiveAccess(sessionUserContext, "tsk_parked", tx),
    ).resolves.toMatchObject({ id: "tsk_parked" });

    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org_123",
        userId: "user_123",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
  });

  it("rejects non-owners for non-parked tasks", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      requireTaskArchiveAccess(sessionUserContext, "tsk_123", tx),
    ).rejects.toThrow("Task not found");
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
    const coworkerContext = createCoworkerContext("cow_123");

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
        archivedAt: null,
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
      userId: "user_123",
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
    const coworkerContext = createCoworkerContext("cow_123");

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      id: "tsk_123",
      coworkerId: "cow_123",
      status: TaskStatus.READY,
      coworker: { vendorId: defaultVendorId },
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
      coworkerId: "cow_123",
      status: TaskStatus.READY,
      coworker: { vendorId: defaultVendorId },
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
      coworkerId: "cow_other",
      status: TaskStatus.READY,
      coworker: { vendorId: defaultVendorId },
    } as never);

    const vars: EnvVariables["Variables"] = {
      isAuthenticated: true,
      authContext: coworkerContext,
      workspaceContext: jobReadWorkspaceContext,
    };

    await requireTaskReadForRouteVars(vars, "tsk_123", tx);
  });
});

describe("requireTaskCommentAccess", () => {
  beforeEach(() => {
    getWorkspaceGrantMock.mockReset();
    requestWorkspaceGrantMock.mockReset();
  });

  it("allows a bare coworker to comment on a same-vendor sibling task", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");
    const siblingTask = {
      id: "tsk_123",
      coworkerId: "cow_other",
      status: TaskStatus.READY,
      coworker: { vendorId: defaultVendorId },
      pendingVendorGrantId: null,
      workspaceId,
      workspace: { organizationId: "org_123" },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(siblingTask as never)
      .mockResolvedValueOnce(siblingTask as never);

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
      userId: "user_owner",
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
      coworkerId: "cow_other",
      status: TaskStatus.READY,
      coworker: { vendorId: defaultVendorId },
      pendingVendorGrantId: null,
      workspaceId,
      workspace: { organizationId: "org_123" },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(siblingTask as never)
      .mockResolvedValueOnce(siblingTask as never);

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
    const foreignVendorId = "01960001-0002-7001-8001-000000000002";

    vi.mocked(tx.coworker.findFirst).mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    // Baseline read miss, then grant read path finds the task.
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "tsk_123",
        coworkerId: "cow_foreign",
        status: TaskStatus.READY,
        pendingVendorGrantId: null,
      } as never)
      .mockResolvedValueOnce({
        id: "tsk_123",
        coworkerId: "cow_foreign",
        status: TaskStatus.READY,
        workspaceId,
        coworker: { vendorId: foreignVendorId },
        workspace: { organizationId: "org_123" },
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

    expect(requestWorkspaceGrantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: defaultVendorId,
        workspaceId,
      }),
      expect.anything(),
    );
  });

  it("does not open PENDING when sibling baseline already allows comment", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123", {
      userId: "user_delegate",
      organizationId: "org_123",
    });
    const siblingTask = {
      id: "tsk_123",
      coworkerId: "cow_other",
      status: TaskStatus.READY,
      coworker: { vendorId: defaultVendorId },
      pendingVendorGrantId: null,
      workspaceId,
      workspace: { organizationId: "org_123" },
    };

    vi.mocked(tx.coworker.findFirst).mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    } as never);
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce(siblingTask as never)
      .mockResolvedValueOnce(siblingTask as never);

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

describe("requireTaskReadForRouteVars vendor grants", () => {
  beforeEach(() => {
    getWorkspaceGrantMock.mockReset();
    requestWorkspaceGrantMock.mockReset();
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
        coworkerId: "cow_foreign",
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

    expect(requestWorkspaceGrantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: defaultVendorId,
        workspaceId,
      }),
      expect.anything(),
    );
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
        coworkerId: "cow_foreign",
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
        coworkerId: "cow_foreign",
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
      userId: "user_delegate",
      coworkerId: "cow_other",
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
      coworkerId: "cow_123",
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

const delegatedCoworkerContext = createCoworkerContext("cow_123", {
  userId: "user_delegate",
  organizationId: "org_123",
});

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

  it("rejects a coworker without context headers", async () => {
    const tx = createTransactionClient();
    const coworkerContext = createCoworkerContext("cow_123");

    await expect(
      requireConversationCoworkerAccess(
        coworkerContext,
        { coworker_id: "cow_123" },
        tx,
      ),
    ).rejects.toThrow(
      "Context headers (X-Context-User-Id) are required for this resource",
    );
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
      coworkerId: "cow_123",
      status: TaskStatus.READY,
      coworker: { vendorId: defaultVendorId },
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
      coworkerId: "cow_other",
      status: TaskStatus.READY,
      coworker: { vendorId: defaultVendorId },
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
    // Baseline miss + out-of-scope task missing → not found
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
      coworkerId: "cow_other",
      status: TaskStatus.READY,
      coworker: { vendorId: defaultVendorId },
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
    vi.mocked(tx.task.findFirst)
      .mockResolvedValueOnce({
        coworkerId: "cow_123",
      } as never)
      .mockResolvedValueOnce({
        pendingVendorGrantId: null,
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

  it("rejects job collaboration when the parent task is parked", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      taskId: "tsk_123",
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      pendingVendorGrantId: "grant_1",
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

  it("rejects a bare coworker without context headers", async () => {
    const tx = createTransactionClient();
    const bareCoworkerContext = createCoworkerContext("cow_123");

    await expect(
      requireJobCollaboration(bareCoworkerContext, "job_123", tx),
    ).rejects.toThrow("Context headers");

    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });
});
