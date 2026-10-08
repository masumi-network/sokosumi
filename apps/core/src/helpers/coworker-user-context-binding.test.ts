import { TaskStatus, VendorGrantStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  assertCoworkerUserContextBinding,
  filterAuthorizedOrganizationIds,
  filterAuthorizedWorkspaceIds,
  listAuthorizedUserWorkspaces,
  requireAuthorizedUserContext,
} from "./coworker-user-context-binding";

const {
  resolveWorkspaceForContextMock,
  getWorkspaceGrantMock,
  isGrantDeniedOrRevokedMock,
  throwGrantAccessErrorMock,
  taskFindFirstMock,
  taskFindManyMock,
  workspaceFindManyMock,
  vendorGrantFindManyMock,
  listUserWorkspacesMock,
} = vi.hoisted(() => ({
  listUserWorkspacesMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  workspaceFindManyMock: vi.fn(),
  vendorGrantFindManyMock: vi.fn(),
  resolveWorkspaceForContextMock: vi.fn(),
  getWorkspaceGrantMock: vi.fn(),
  isGrantDeniedOrRevokedMock: vi.fn(),
  throwGrantAccessErrorMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    workspaceRepository: {
      resolveWorkspaceForContext: (...args: unknown[]) =>
        resolveWorkspaceForContextMock(...args),
    },
  };
});

vi.mock("@/helpers/user-workspaces", () => ({
  listUserWorkspaces: (...args: unknown[]) => listUserWorkspacesMock(...args),
}));

vi.mock("./vendor-grants", () => ({
  getWorkspaceGrant: (...args: unknown[]) => getWorkspaceGrantMock(...args),
  isGrantDeniedOrRevoked: (...args: unknown[]) =>
    isGrantDeniedOrRevokedMock(...args),
  throwGrantAccessError: (...args: unknown[]) =>
    throwGrantAccessErrorMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findFirst: (...args: unknown[]) => taskFindFirstMock(...args),
      findMany: (...args: unknown[]) => taskFindManyMock(...args),
    },
    workspace: {
      findMany: (...args: unknown[]) => workspaceFindManyMock(...args),
    },
    vendorGrant: {
      findMany: (...args: unknown[]) => vendorGrantFindManyMock(...args),
    },
  },
}));

const coworkerAuth = {
  actor: "coworker" as const,
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_1", organizationId: null as string | null },
};

describe("assertCoworkerUserContextBinding", () => {
  beforeEach(() => {
    resolveWorkspaceForContextMock.mockReset();
    getWorkspaceGrantMock.mockReset();
    isGrantDeniedOrRevokedMock.mockReset();
    throwGrantAccessErrorMock.mockReset();
    taskFindFirstMock.mockReset();
    resolveWorkspaceForContextMock.mockResolvedValue({ id: "ws_1" });
    getWorkspaceGrantMock.mockResolvedValue(null);
    isGrantDeniedOrRevokedMock.mockReturnValue(false);
    throwGrantAccessErrorMock.mockImplementation(
      (status: VendorGrantStatus) => {
        throw new HTTPException(403, {
          message: `grant blocked: ${status}`,
        });
      },
    );
    taskFindFirstMock.mockResolvedValue(null);
  });

  it("allows coworker when vendor has GRANTED workspace access", async () => {
    getWorkspaceGrantMock.mockResolvedValue({
      id: "g1",
      status: VendorGrantStatus.GRANTED,
      permission: "workspace",
    });

    await expect(
      assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: null,
      }),
    ).resolves.toBeUndefined();

    expect(resolveWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_1",
      null,
      expect.anything(),
    );
    expect(getWorkspaceGrantMock).toHaveBeenCalledWith(
      { vendorId: TEST_VENDOR_ID, workspaceId: "ws_1" },
      expect.anything(),
    );
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it("allows coworker when baseline task relationship exists and grant is not denied/revoked", async () => {
    taskFindFirstMock.mockResolvedValue({ id: "task_1" });

    await expect(
      assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: null,
      }),
    ).resolves.toBeUndefined();

    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: "user_1",
          workspaceId: "ws_1",
          archivedAt: null,
          status: { not: TaskStatus.DRAFT },
        }),
        select: { id: true },
      }),
    );
  });

  it("rejects DENIED grant even when coworker is assigned to a task", async () => {
    getWorkspaceGrantMock.mockResolvedValue({
      id: "g1",
      status: VendorGrantStatus.DENIED,
      permission: "workspace",
    });
    isGrantDeniedOrRevokedMock.mockReturnValue(true);
    taskFindFirstMock.mockResolvedValue({ id: "task_1" });

    await expect(
      assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: null,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(throwGrantAccessErrorMock).toHaveBeenCalledWith(
      VendorGrantStatus.DENIED,
    );
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it("rejects REVOKED grant even when coworker is assigned to a task", async () => {
    getWorkspaceGrantMock.mockResolvedValue({
      id: "g1",
      status: VendorGrantStatus.REVOKED,
      permission: "workspace",
    });
    isGrantDeniedOrRevokedMock.mockReturnValue(true);
    taskFindFirstMock.mockResolvedValue({ id: "task_1" });

    await expect(
      assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: null,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(throwGrantAccessErrorMock).toHaveBeenCalledWith(
      VendorGrantStatus.REVOKED,
    );
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it("rejects coworker with no grant and no baseline task relationship", async () => {
    await expect(
      assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: null,
      }),
    ).rejects.toBeInstanceOf(HTTPException);

    try {
      await assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: null,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(403);
    }
  });

  it("rejects PENDING grant without baseline relationship", async () => {
    getWorkspaceGrantMock.mockResolvedValue({
      id: "g1",
      status: VendorGrantStatus.PENDING,
      permission: "workspace",
    });
    taskFindFirstMock.mockResolvedValue(null);

    await expect(
      assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: "org_1",
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(resolveWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      expect.anything(),
    );
    expect(isGrantDeniedOrRevokedMock).toHaveBeenCalledWith(
      VendorGrantStatus.PENDING,
    );
  });

  it("asks for X-Context-Organization-Id when the context user has no personal workspace", async () => {
    const { PersonalWorkspaceMissingError } = await import(
      "@sokosumi/database/repositories"
    );
    resolveWorkspaceForContextMock.mockRejectedValueOnce(
      new PersonalWorkspaceMissingError(),
    );

    await expect(
      assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: null,
      }),
    ).rejects.toMatchObject({
      status: 400,
      cause: { kind: "context_organization_required" },
    });
    expect(getWorkspaceGrantMock).not.toHaveBeenCalled();
  });
});

describe("requireAuthorizedUserContext", () => {
  beforeEach(() => {
    resolveWorkspaceForContextMock.mockReset();
    getWorkspaceGrantMock.mockReset();
    isGrantDeniedOrRevokedMock.mockReset();
    throwGrantAccessErrorMock.mockReset();
    taskFindFirstMock.mockReset();
    resolveWorkspaceForContextMock.mockResolvedValue({ id: "ws_1" });
    getWorkspaceGrantMock.mockResolvedValue(null);
    isGrantDeniedOrRevokedMock.mockReturnValue(false);
    taskFindFirstMock.mockResolvedValue(null);
  });

  it("returns session user context without binding checks", async () => {
    const ctx = await requireAuthorizedUserContext({
      actor: "user",
      userId: "user_1",
      organizationId: null,
      role: "user",
    });
    expect(ctx).toMatchObject({
      source: "session",
      userId: "user_1",
    });
    expect(getWorkspaceGrantMock).not.toHaveBeenCalled();
  });

  it("rejects unbound coworker context", async () => {
    await expect(
      requireAuthorizedUserContext(coworkerAuth),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows coworker with GRANTED binding", async () => {
    getWorkspaceGrantMock.mockResolvedValue({
      id: "g1",
      status: VendorGrantStatus.GRANTED,
      permission: "workspace",
    });
    const ctx = await requireAuthorizedUserContext(coworkerAuth);
    expect(ctx).toEqual({
      source: "context",
      userId: "user_1",
      organizationId: null,
    });
  });
});

describe("filterAuthorizedOrganizationIds", () => {
  beforeEach(() => {
    workspaceFindManyMock.mockReset();
    vendorGrantFindManyMock.mockReset();
    taskFindManyMock.mockReset();
    isGrantDeniedOrRevokedMock.mockImplementation(
      (status: VendorGrantStatus) =>
        status === VendorGrantStatus.DENIED ||
        status === VendorGrantStatus.REVOKED,
    );
  });

  it("returns every organization for a session user", async () => {
    const result = await filterAuthorizedOrganizationIds(
      {
        actor: "user",
        userId: "user_1",
        organizationId: null,
        role: "user",
      },
      "user_1",
      ["org_a", "org_b"],
    );

    expect([...result]).toEqual(["org_a", "org_b"]);
    expect(workspaceFindManyMock).not.toHaveBeenCalled();
  });

  it("keeps only organizations whose workspace the coworker's vendor may act in", async () => {
    workspaceFindManyMock.mockResolvedValue([
      { id: "ws_granted", organizationId: "org_granted" },
      { id: "ws_task", organizationId: "org_task" },
      { id: "ws_none", organizationId: "org_none" },
      { id: "ws_denied", organizationId: "org_denied" },
      { id: "ws_pending", organizationId: "org_pending" },
    ]);
    vendorGrantFindManyMock.mockResolvedValue([
      { workspaceId: "ws_granted", status: VendorGrantStatus.GRANTED },
      { workspaceId: "ws_denied", status: VendorGrantStatus.DENIED },
      { workspaceId: "ws_pending", status: VendorGrantStatus.PENDING },
    ]);
    taskFindManyMock.mockResolvedValue([
      { workspaceId: "ws_task" },
      { workspaceId: "ws_denied" },
    ]);

    const result = await filterAuthorizedOrganizationIds(
      coworkerAuth,
      "user_1",
      ["org_granted", "org_task", "org_none", "org_denied", "org_pending"],
    );

    expect([...result].sort()).toEqual(["org_granted", "org_task"]);
  });
});

describe("filterAuthorizedWorkspaceIds", () => {
  beforeEach(() => {
    vendorGrantFindManyMock.mockReset();
    taskFindManyMock.mockReset();
    isGrantDeniedOrRevokedMock.mockImplementation(
      (status: VendorGrantStatus) =>
        status === VendorGrantStatus.DENIED ||
        status === VendorGrantStatus.REVOKED,
    );
  });

  it("keeps a granted personal workspace and drops one with only a pending grant", async () => {
    vendorGrantFindManyMock.mockResolvedValue([
      { workspaceId: "ws_personal", status: VendorGrantStatus.GRANTED },
      { workspaceId: "ws_org", status: VendorGrantStatus.PENDING },
    ]);
    taskFindManyMock.mockResolvedValue([]);

    const result = await filterAuthorizedWorkspaceIds(coworkerAuth, "user_1", [
      "ws_personal",
      "ws_org",
    ]);

    expect([...result]).toEqual(["ws_personal"]);
  });

  it("returns every workspace for a Soko Bot", async () => {
    const result = await filterAuthorizedWorkspaceIds(
      {
        actor: "sokoBot",
        sokoBotId: "bot_1",
        userId: "user_1",
        workspaceId: "ws_personal",
        organizationId: null,
      },
      "user_1",
      ["ws_personal", "ws_org"],
    );

    expect([...result]).toEqual(["ws_personal", "ws_org"]);
    expect(vendorGrantFindManyMock).not.toHaveBeenCalled();
  });
});

describe("listAuthorizedUserWorkspaces", () => {
  const workspace = (id: string, preferred = false) => ({
    id,
    kind: id === "ws_personal" ? "personal" : "organization",
    name: id,
    organizationId: id === "ws_personal" ? null : `org_${id}`,
    slug: null,
    logo: null,
    websiteUrl: null,
    preferred,
  });

  beforeEach(() => {
    listUserWorkspacesMock.mockReset();
    vendorGrantFindManyMock.mockReset();
    taskFindManyMock.mockReset();
    taskFindManyMock.mockResolvedValue([]);
    isGrantDeniedOrRevokedMock.mockImplementation(
      (status: VendorGrantStatus) =>
        status === VendorGrantStatus.DENIED ||
        status === VendorGrantStatus.REVOKED,
    );
    listUserWorkspacesMock.mockResolvedValue({
      workspaces: [
        workspace("ws_personal"),
        workspace("ws_hidden", true),
        workspace("ws_granted"),
      ],
      pendingInvitationCount: 2,
    });
  });

  it("shows a coworker only the workspaces its vendor may act in", async () => {
    vendorGrantFindManyMock.mockResolvedValue([
      { workspaceId: "ws_personal", status: VendorGrantStatus.GRANTED },
      { workspaceId: "ws_granted", status: VendorGrantStatus.GRANTED },
    ]);

    const result = await listAuthorizedUserWorkspaces(coworkerAuth, "user_1");

    expect(result.workspaces.map(({ id }) => id)).toEqual([
      "ws_personal",
      "ws_granted",
    ]);
    // The preferred workspace is hidden, so none is marked preferred.
    expect(result.workspaces.some(({ preferred }) => preferred)).toBe(false);
    expect(result.pendingInvitationCount).toBe(0);
  });

  it("rejects a coworker whose vendor may act in none of the workspaces", async () => {
    vendorGrantFindManyMock.mockResolvedValue([]);

    await expect(
      listAuthorizedUserWorkspaces(coworkerAuth, "user_1"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("shows a Soko Bot its owner's full list", async () => {
    const result = await listAuthorizedUserWorkspaces(
      {
        actor: "sokoBot",
        sokoBotId: "bot_1",
        userId: "user_1",
        workspaceId: "ws_personal",
        organizationId: null,
      },
      "user_1",
    );

    expect(result.workspaces).toHaveLength(3);
    expect(result.pendingInvitationCount).toBe(2);
  });
});
