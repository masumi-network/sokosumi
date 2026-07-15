import { VendorGrantStatus, VendorPermission } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  approveVendorGrantInWorkspace,
  buildCoworkerTaskListAccessFilter,
  cancelParkedTasksForGrant,
  grantWorkspaceAccess,
  hasGrantedWorkspaceAccess,
  isBaselineCoworkerTaskAccess,
  isGrantDeniedOrRevoked,
  notifyWorkspaceApproversOfPendingGrant,
  requestWorkspaceGrant,
  requireTaskNotParked,
  throwGrantAccessError,
  toApiVendorPermission,
  unparkTasksForGrant,
  VendorPermissionApi,
} from "./vendor-grants";

const vendorGrantFindUnique = vi.fn();
const vendorGrantFindFirst = vi.fn();
const vendorGrantCreate = vi.fn();
const vendorGrantUpsert = vi.fn();
const vendorGrantUpdate = vi.fn();
const taskFindMany = vi.fn();
const taskUpdateMany = vi.fn();
const taskEventCreate = vi.fn();
const memberFindMany = vi.fn();
const workspaceFindUnique = vi.fn();
const createNotificationMock = vi.fn();
const queryRawMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendorGrant: {
      findUnique: (...args: unknown[]) => vendorGrantFindUnique(...args),
      findFirst: (...args: unknown[]) => vendorGrantFindFirst(...args),
      create: (...args: unknown[]) => vendorGrantCreate(...args),
      upsert: (...args: unknown[]) => vendorGrantUpsert(...args),
      update: (...args: unknown[]) => vendorGrantUpdate(...args),
    },
    task: {
      findMany: (...args: unknown[]) => taskFindMany(...args),
      updateMany: (...args: unknown[]) => taskUpdateMany(...args),
    },
    taskEvent: {
      create: (...args: unknown[]) => taskEventCreate(...args),
    },
    member: {
      findMany: (...args: unknown[]) => memberFindMany(...args),
    },
    workspace: {
      findUnique: (...args: unknown[]) => workspaceFindUnique(...args),
    },
    vendor: { findUnique: vi.fn().mockResolvedValue({ name: "V", slug: "v" }) },
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    $executeRaw: (...args: unknown[]) => executeRawMock(...args),
  },
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
}));

describe("vendor-grants helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRawMock.mockResolvedValue([]);
    executeRawMock.mockResolvedValue(undefined);
  });

  it("maps Prisma workspace permission to API string", () => {
    expect(toApiVendorPermission(VendorPermission.workspace)).toBe(
      VendorPermissionApi.WORKSPACE,
    );
  });

  it("treats DENIED and REVOKED as terminal denies", () => {
    expect(isGrantDeniedOrRevoked(VendorGrantStatus.DENIED)).toBe(true);
    expect(isGrantDeniedOrRevoked(VendorGrantStatus.REVOKED)).toBe(true);
    expect(isGrantDeniedOrRevoked(VendorGrantStatus.PENDING)).toBe(false);
  });

  it("detects baseline sibling access", () => {
    expect(
      isBaselineCoworkerTaskAccess({
        actorCoworkerId: "c1",
        actorVendorId: "v1",
        task: {
          coworkerId: "c2",
          status: TaskStatus.READY,
          coworker: { vendorId: "v1" },
        },
      }),
    ).toBe(true);

    expect(
      isBaselineCoworkerTaskAccess({
        actorCoworkerId: "c1",
        actorVendorId: "v1",
        task: {
          coworkerId: "c2",
          status: TaskStatus.READY,
          coworker: { vendorId: "v2" },
        },
      }),
    ).toBe(false);
  });

  it("expands list filter when workspace grant is present", () => {
    const withGrant = buildCoworkerTaskListAccessFilter({
      coworkerId: "c1",
      vendorId: "v1",
      hasWorkspaceGrant: true,
    });
    expect(withGrant).toEqual({ status: { not: TaskStatus.DRAFT } });

    const baseline = buildCoworkerTaskListAccessFilter({
      coworkerId: "c1",
      vendorId: "v1",
      hasWorkspaceGrant: false,
    });
    expect(baseline.OR).toBeDefined();
  });

  it("does not reopen existing grants on requestWorkspaceGrant", async () => {
    queryRawMock.mockResolvedValue([{ id: "g1" }]);
    vendorGrantFindUnique.mockResolvedValue({
      id: "g1",
      status: VendorGrantStatus.DENIED,
      permission: VendorPermission.workspace,
    });

    const result = await requestWorkspaceGrant({
      vendorId: "v1",
      workspaceId: "w1",
    });

    expect(result.created).toBe(false);
    expect(vendorGrantCreate).not.toHaveBeenCalled();
    expect(queryRawMock).toHaveBeenCalled();
    const sqlParts = queryRawMock.mock.calls[0]![0] as TemplateStringsArray;
    expect(sqlParts.join(" ")).toContain("FOR UPDATE");
  });

  it("locks the workspace grant row before creating a PENDING grant", async () => {
    queryRawMock.mockResolvedValueOnce([]);
    vendorGrantCreate.mockResolvedValue({
      id: "g2",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.workspace,
    });

    await requestWorkspaceGrant({
      vendorId: "v1",
      workspaceId: "w1",
      requestedByUserId: "u1",
      notify: false,
    });

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const lockSql = queryRawMock.mock.calls[0]![0] as TemplateStringsArray;
    expect(lockSql.join(" ")).toContain("FOR UPDATE");
  });

  it("creates PENDING workspace grant when no row exists", async () => {
    queryRawMock.mockResolvedValueOnce([]);
    vendorGrantCreate.mockResolvedValue({
      id: "g2",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.workspace,
    });

    const result = await requestWorkspaceGrant({
      vendorId: "v1",
      workspaceId: "w1",
      requestedByUserId: "u1",
    });

    expect(result.created).toBe(true);
    expect(vendorGrantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        permission: VendorPermission.workspace,
        status: VendorGrantStatus.PENDING,
      }),
    });
  });

  it("unparks and cancels parked tasks by grant id", async () => {
    taskFindMany.mockResolvedValue([
      { id: "t1", grantResumeStatus: "READY" },
      { id: "t2", grantResumeStatus: "DRAFT" },
    ]);
    taskUpdateMany.mockResolvedValue({ count: 1 });
    taskEventCreate.mockResolvedValue({ id: "ev1" });

    await expect(unparkTasksForGrant("g1", undefined, "u1")).resolves.toBe(2);

    expect(taskFindMany).toHaveBeenCalledWith({
      where: {
        pendingVendorGrantId: "g1",
        archivedAt: null,
        status: TaskStatus.GRANT_PENDING,
      },
      select: { id: true, grantResumeStatus: true },
    });
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "t1",
        pendingVendorGrantId: "g1",
        archivedAt: null,
        status: TaskStatus.GRANT_PENDING,
      },
      data: {
        status: TaskStatus.READY,
        pendingVendorGrantId: null,
        grantResumeStatus: null,
      },
    });
    expect(taskEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "t1",
        status: TaskStatus.READY,
        userId: "u1",
      }),
    });

    taskFindMany.mockResolvedValue([{ id: "t1" }]);
    taskUpdateMany.mockResolvedValue({ count: 1 });
    taskEventCreate.mockResolvedValue({ id: "ev2" });
    await expect(
      cancelParkedTasksForGrant({ grantId: "g1", resolvedById: "u1" }),
    ).resolves.toBe(1);
    expect(taskFindMany).toHaveBeenCalledWith({
      where: {
        pendingVendorGrantId: "g1",
        archivedAt: null,
        status: TaskStatus.GRANT_PENDING,
      },
      select: { id: true },
    });
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "t1",
        pendingVendorGrantId: "g1",
        archivedAt: null,
        status: TaskStatus.GRANT_PENDING,
      },
      data: {
        status: TaskStatus.CANCELED,
        pendingVendorGrantId: null,
        grantResumeStatus: null,
      },
    });
    expect(taskEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "t1",
        status: TaskStatus.CANCELED,
        userId: "u1",
      }),
    });
  });

  it("skips cancel when only archived parked tasks remain", async () => {
    taskFindMany.mockResolvedValue([]);
    await expect(
      cancelParkedTasksForGrant({ grantId: "g1", resolvedById: "u1" }),
    ).resolves.toBe(0);
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(taskEventCreate).not.toHaveBeenCalled();
  });

  it("reports GRANTED only via hasGrantedWorkspaceAccess", async () => {
    vendorGrantFindUnique.mockResolvedValue({
      status: VendorGrantStatus.GRANTED,
    });
    await expect(
      hasGrantedWorkspaceAccess({
        vendorId: "v1",
        workspaceId: "w1",
      }),
    ).resolves.toBe(true);

    vendorGrantFindUnique.mockResolvedValue({
      status: VendorGrantStatus.PENDING,
    });
    await expect(
      hasGrantedWorkspaceAccess({
        vendorId: "v1",
        workspaceId: "w1",
      }),
    ).resolves.toBe(false);
  });

  it("looks up workspace grant by vendorId_workspaceId", async () => {
    vendorGrantFindUnique.mockResolvedValue({
      id: "g1",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.workspace,
    });

    const { getWorkspaceGrant } = await import("./vendor-grants");
    const grant = await getWorkspaceGrant({
      vendorId: "v1",
      workspaceId: "w1",
    });

    expect(grant).toMatchObject({ id: "g1" });
    expect(vendorGrantFindUnique).toHaveBeenCalledWith({
      where: {
        vendorId_workspaceId: {
          vendorId: "v1",
          workspaceId: "w1",
        },
      },
      select: { id: true, status: true, permission: true },
    });
  });

  it("blocks mutations on parked tasks", () => {
    expect(() =>
      requireTaskNotParked({ status: TaskStatus.GRANT_PENDING }),
    ).toThrow(HTTPException);

    expect(() =>
      requireTaskNotParked({ status: TaskStatus.READY }),
    ).not.toThrow();
  });

  it("throws grant_required / grant_denied / grant_revoked kinds", () => {
    try {
      throwGrantAccessError(null);
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).cause).toMatchObject({
        kind: "grant_required",
        extensions: { permission: "workspace" },
      });
    }

    try {
      throwGrantAccessError(VendorGrantStatus.DENIED);
    } catch (error) {
      expect((error as HTTPException).cause).toMatchObject({
        kind: "grant_denied",
        extensions: { permission: "workspace" },
      });
    }

    try {
      throwGrantAccessError(VendorGrantStatus.REVOKED);
    } catch (error) {
      expect((error as HTTPException).cause).toMatchObject({
        kind: "grant_revoked",
        extensions: { permission: "workspace" },
      });
    }
  });

  it("notifies approvers when a new PENDING workspace grant is created", async () => {
    queryRawMock.mockResolvedValueOnce([]);
    vendorGrantCreate.mockResolvedValue({
      id: "workspace-grant",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.workspace,
    });
    memberFindMany.mockResolvedValue([{ userId: "owner_1" }]);
    workspaceFindUnique.mockResolvedValue({
      userId: null,
      organizationId: "org_1",
    });
    createNotificationMock.mockResolvedValue({ created: true });

    await requestWorkspaceGrant({
      vendorId: "v1",
      workspaceId: "w1",
      requestedByUserId: "u1",
    });

    expect(vendorGrantCreate).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: "notifications.vendorGrant.pending",
        referenceId: "workspace-grant",
        messageParams: expect.objectContaining({
          permission: VendorPermissionApi.WORKSPACE,
        }),
      }),
      expect.anything(),
    );
  });

  it("does not re-notify when workspace grant already exists", async () => {
    queryRawMock.mockResolvedValue([{ id: "workspace-grant" }]);
    vendorGrantFindUnique.mockResolvedValue({
      id: "workspace-grant",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.workspace,
    });

    await requestWorkspaceGrant({
      vendorId: "v1",
      workspaceId: "w1",
    });

    expect(vendorGrantCreate).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("notifies the personal workspace owner when workspace grant is requested", async () => {
    queryRawMock.mockResolvedValueOnce([]);
    vendorGrantCreate.mockResolvedValue({
      id: "workspace-grant",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.workspace,
    });
    workspaceFindUnique.mockResolvedValue({
      userId: "personal_owner",
      organizationId: null,
    });
    createNotificationMock.mockResolvedValue({ created: true });

    await requestWorkspaceGrant({
      vendorId: "v1",
      workspaceId: "w1",
      requestedByUserId: "u1",
    });

    expect(memberFindMany).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "personal_owner",
        messageKey: "notifications.vendorGrant.pending",
      }),
      expect.anything(),
    );
  });

  it("returns existing grant on concurrent PENDING create unique race", async () => {
    queryRawMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "raced-grant" }]);
    vendorGrantFindUnique.mockResolvedValue({
      id: "raced-grant",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.workspace,
    });
    vendorGrantCreate.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await requestWorkspaceGrant({
      vendorId: "v1",
      workspaceId: "w1",
    });

    expect(result).toEqual({
      grant: expect.objectContaining({ id: "raced-grant" }),
      created: false,
    });
    expect(executeRawMock).toHaveBeenCalled();
  });

  it("grants workspace access and unparks linked tasks", async () => {
    vendorGrantUpsert.mockResolvedValue({
      id: "g1",
      vendorId: "v1",
      workspaceId: "w1",
      permission: VendorPermission.workspace,
      status: VendorGrantStatus.GRANTED,
      vendor: { name: "V", slug: "v" },
    });
    taskFindMany.mockResolvedValue([
      { id: "t1", grantResumeStatus: "READY" },
      { id: "t2", grantResumeStatus: "DRAFT" },
    ]);
    taskUpdateMany.mockResolvedValue({ count: 1 });
    taskEventCreate.mockResolvedValue({ id: "ev1" });

    const grant = await grantWorkspaceAccess({
      vendorId: "v1",
      workspaceId: "w1",
      resolvedById: "u1",
    });

    expect(grant.status).toBe(VendorGrantStatus.GRANTED);
    expect(vendorGrantUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          vendorId_workspaceId: {
            vendorId: "v1",
            workspaceId: "w1",
          },
        },
        create: expect.objectContaining({
          permission: VendorPermission.workspace,
          status: VendorGrantStatus.GRANTED,
        }),
      }),
    );
    expect(taskUpdateMany).toHaveBeenCalled();
  });

  it("unparks on approve even when grant is already GRANTED", async () => {
    const existing = {
      id: "g1",
      vendorId: "v1",
      workspaceId: "w1",
      permission: VendorPermission.workspace,
      status: VendorGrantStatus.GRANTED,
      requestedByUserId: null,
      resolvedAt: new Date(),
      resolvedById: "u1",
      createdAt: new Date(),
      updatedAt: new Date(),
      vendor: { name: "V", slug: "v" },
    };
    vendorGrantFindFirst.mockResolvedValue(existing);
    taskFindMany.mockResolvedValue([{ id: "t1", grantResumeStatus: "READY" }]);
    taskUpdateMany.mockResolvedValue({ count: 1 });
    taskEventCreate.mockResolvedValue({ id: "ev1" });

    const tx = {
      $queryRaw: queryRawMock,
      vendorGrant: {
        findFirst: vendorGrantFindFirst,
        update: vendorGrantUpdate,
      },
      task: {
        findMany: taskFindMany,
        updateMany: taskUpdateMany,
      },
      taskEvent: { create: taskEventCreate },
    };

    const result = await approveVendorGrantInWorkspace(
      {
        grantId: "g1",
        workspaceId: "w1",
        resolvedById: "u1",
      },
      tx as never,
    );

    expect(result.status).toBe(VendorGrantStatus.GRANTED);
    expect(vendorGrantUpdate).not.toHaveBeenCalled();
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "t1",
        pendingVendorGrantId: "g1",
        archivedAt: null,
        status: TaskStatus.GRANT_PENDING,
      },
      data: {
        status: TaskStatus.READY,
        pendingVendorGrantId: null,
        grantResumeStatus: null,
      },
    });
    const lockSql = queryRawMock.mock.calls[0]![0] as TemplateStringsArray;
    expect(lockSql.join(" ")).toContain("FOR UPDATE");
  });

  it("notifies approvers via notifyWorkspaceApproversOfPendingGrant", async () => {
    memberFindMany.mockResolvedValue([{ userId: "admin_1" }]);
    workspaceFindUnique.mockResolvedValue({
      userId: null,
      organizationId: "org_1",
    });
    createNotificationMock.mockResolvedValue({ created: true });

    await notifyWorkspaceApproversOfPendingGrant({
      vendorId: "v1",
      workspaceId: "w1",
      grantId: "grant_1",
    });

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin_1",
        referenceId: "grant_1",
        messageKey: "notifications.vendorGrant.pending",
        metadata: expect.objectContaining({
          permission: VendorPermissionApi.WORKSPACE,
        }),
      }),
      expect.anything(),
    );
  });

  it("keeps baseline DRAFT tasks out of sibling access", () => {
    expect(
      isBaselineCoworkerTaskAccess({
        actorCoworkerId: "c1",
        actorVendorId: "v1",
        task: {
          coworkerId: "c1",
          status: TaskStatus.DRAFT,
          coworker: { vendorId: "v1" },
        },
      }),
    ).toBe(false);
  });
});
