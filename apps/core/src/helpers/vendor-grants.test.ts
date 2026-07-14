import { VendorGrantStatus, VendorPermission } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCoworkerTaskListAccessFilter,
  cancelParkedTasksForGrant,
  hasGrantedVendorPermission,
  isBaselineCoworkerTaskAccess,
  isGrantDeniedOrRevoked,
  requestCommentGrant,
  requestCreateGrant,
  requestReadGrantWithBundledComment,
  requireTaskNotParked,
  throwGrantAccessError,
  toApiVendorPermission,
  toPrismaVendorPermission,
  unparkTasksForGrant,
  upsertPendingVendorGrant,
  VendorPermissionApi,
} from "./vendor-grants";

const vendorGrantFindUnique = vi.fn();
const vendorGrantCreate = vi.fn();
const taskUpdateMany = vi.fn();
const memberFindMany = vi.fn();
const workspaceFindUnique = vi.fn();
const createNotificationMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendorGrant: {
      findUnique: (...args: unknown[]) => vendorGrantFindUnique(...args),
      create: (...args: unknown[]) => vendorGrantCreate(...args),
    },
    task: {
      updateMany: (...args: unknown[]) => taskUpdateMany(...args),
    },
    member: {
      findMany: (...args: unknown[]) => memberFindMany(...args),
    },
    workspace: {
      findUnique: (...args: unknown[]) => workspaceFindUnique(...args),
    },
    vendor: { findUnique: vi.fn().mockResolvedValue({ name: "V", slug: "v" }) },
  },
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
}));

describe("vendor-grants helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps API permission strings to Prisma enums", () => {
    expect(toPrismaVendorPermission(VendorPermissionApi.TASK_READ)).toBe(
      VendorPermission.task_read,
    );
    expect(toApiVendorPermission(VendorPermission.task_create)).toBe(
      VendorPermissionApi.TASK_CREATE,
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

  it("expands list filter when read grant is present", () => {
    const withGrant = buildCoworkerTaskListAccessFilter({
      coworkerId: "c1",
      vendorId: "v1",
      hasReadGrant: true,
    });
    expect(withGrant).toEqual({ status: { not: TaskStatus.DRAFT } });

    const baseline = buildCoworkerTaskListAccessFilter({
      coworkerId: "c1",
      vendorId: "v1",
      hasReadGrant: false,
    });
    expect(baseline.OR).toBeDefined();
  });

  it("does not reopen existing grants on upsert PENDING", async () => {
    vendorGrantFindUnique.mockResolvedValue({
      id: "g1",
      status: VendorGrantStatus.DENIED,
      permission: VendorPermission.task_read,
    });

    const result = await upsertPendingVendorGrant({
      vendorId: "v1",
      workspaceId: "w1",
      permission: VendorPermission.task_read,
    });

    expect(result.created).toBe(false);
    expect(vendorGrantCreate).not.toHaveBeenCalled();
  });

  it("creates PENDING when no row exists", async () => {
    vendorGrantFindUnique.mockResolvedValue(null);
    vendorGrantCreate.mockResolvedValue({
      id: "g2",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.task_create,
    });

    const result = await upsertPendingVendorGrant({
      vendorId: "v1",
      workspaceId: "w1",
      permission: VendorPermission.task_create,
      requestedByUserId: "u1",
    });

    expect(result.created).toBe(true);
    expect(vendorGrantCreate).toHaveBeenCalled();
  });

  it("unparks and cancels parked tasks by grant id", async () => {
    taskUpdateMany.mockResolvedValue({ count: 2 });
    await expect(unparkTasksForGrant("g1")).resolves.toBe(2);
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { pendingVendorGrantId: "g1" },
      data: { pendingVendorGrantId: null },
    });

    taskUpdateMany.mockResolvedValue({ count: 1 });
    await expect(cancelParkedTasksForGrant("g1")).resolves.toBe(1);
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { pendingVendorGrantId: "g1" },
      data: {
        status: TaskStatus.CANCELED,
        pendingVendorGrantId: null,
      },
    });
  });

  it("reports GRANTED only via hasGrantedVendorPermission", async () => {
    vendorGrantFindUnique.mockResolvedValue({
      status: VendorGrantStatus.GRANTED,
    });
    await expect(
      hasGrantedVendorPermission({
        vendorId: "v1",
        workspaceId: "w1",
        permission: VendorPermission.task_read,
      }),
    ).resolves.toBe(true);

    vendorGrantFindUnique.mockResolvedValue({
      status: VendorGrantStatus.PENDING,
    });
    await expect(
      hasGrantedVendorPermission({
        vendorId: "v1",
        workspaceId: "w1",
        permission: VendorPermission.task_comment,
      }),
    ).resolves.toBe(false);
  });

  it("blocks mutations on parked tasks", () => {
    expect(() => requireTaskNotParked({ pendingVendorGrantId: "g1" })).toThrow(
      HTTPException,
    );

    expect(() =>
      requireTaskNotParked({ pendingVendorGrantId: null }),
    ).not.toThrow();
  });

  it("throws grant_required / grant_denied / grant_revoked kinds", () => {
    try {
      throwGrantAccessError(null, VendorPermissionApi.TASK_READ);
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).cause).toMatchObject({
        kind: "grant_required",
        extensions: { permission: "task:read" },
      });
    }

    try {
      throwGrantAccessError(
        VendorGrantStatus.DENIED,
        VendorPermissionApi.TASK_COMMENT,
      );
    } catch (error) {
      expect((error as HTTPException).cause).toMatchObject({
        kind: "grant_denied",
        extensions: { permission: "task:comment" },
      });
    }

    try {
      throwGrantAccessError(
        VendorGrantStatus.REVOKED,
        VendorPermissionApi.TASK_CREATE,
      );
    } catch (error) {
      expect((error as HTTPException).cause).toMatchObject({
        kind: "grant_revoked",
        extensions: { permission: "task:create" },
      });
    }
  });

  it("upserts bundled PENDING read+comment and notifies once", async () => {
    vendorGrantFindUnique.mockResolvedValue(null);
    vendorGrantCreate
      .mockResolvedValueOnce({
        id: "read-grant",
        status: VendorGrantStatus.PENDING,
        permission: VendorPermission.task_read,
      })
      .mockResolvedValueOnce({
        id: "comment-grant",
        status: VendorGrantStatus.PENDING,
        permission: VendorPermission.task_comment,
      });
    memberFindMany.mockResolvedValue([{ userId: "owner_1" }]);
    workspaceFindUnique.mockResolvedValue({
      userId: null,
      organizationId: "org_1",
    });
    createNotificationMock.mockResolvedValue({ created: true });

    await requestReadGrantWithBundledComment({
      vendorId: "v1",
      workspaceId: "w1",
      requestedByUserId: "u1",
    });

    expect(vendorGrantCreate).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: "notifications.vendorGrant.pendingReadComment",
        referenceId: "read-grant",
      }),
    );
  });

  it("does not re-notify when read and comment are already PENDING", async () => {
    vendorGrantFindUnique
      .mockResolvedValueOnce({
        id: "read-grant",
        status: VendorGrantStatus.PENDING,
        permission: VendorPermission.task_read,
      })
      .mockResolvedValueOnce({
        id: "comment-grant",
        status: VendorGrantStatus.PENDING,
        permission: VendorPermission.task_comment,
      });

    await requestReadGrantWithBundledComment({
      vendorId: "v1",
      workspaceId: "w1",
    });

    expect(vendorGrantCreate).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("upserts only PENDING task:comment for comment requests", async () => {
    vendorGrantFindUnique.mockResolvedValue(null);
    vendorGrantCreate.mockResolvedValue({
      id: "comment-grant",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.task_comment,
    });
    memberFindMany.mockResolvedValue([{ userId: "admin_1" }]);
    workspaceFindUnique.mockResolvedValue({
      userId: null,
      organizationId: "org_1",
    });
    createNotificationMock.mockResolvedValue({ created: true });

    await requestCommentGrant({
      vendorId: "v1",
      workspaceId: "w1",
      requestedByUserId: "u1",
    });

    expect(vendorGrantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        permission: VendorPermission.task_comment,
        status: VendorGrantStatus.PENDING,
      }),
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: "notifications.vendorGrant.pending",
      }),
    );
  });

  it("upserts PENDING task:create and returns the grant for parking", async () => {
    vendorGrantFindUnique.mockResolvedValue(null);
    vendorGrantCreate.mockResolvedValue({
      id: "create-grant",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.task_create,
    });
    memberFindMany.mockResolvedValue([]);
    workspaceFindUnique.mockResolvedValue({
      userId: null,
      organizationId: "org_1",
    });

    const grant = await requestCreateGrant({
      vendorId: "v1",
      workspaceId: "w1",
      requestedByUserId: "u1",
    });

    expect(grant.id).toBe("create-grant");
    expect(vendorGrantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        permission: VendorPermission.task_create,
      }),
    });
  });

  it("notifies the personal workspace owner when create is requested", async () => {
    vendorGrantFindUnique.mockResolvedValue(null);
    vendorGrantCreate.mockResolvedValue({
      id: "create-grant",
      status: VendorGrantStatus.PENDING,
      permission: VendorPermission.task_create,
    });
    workspaceFindUnique.mockResolvedValue({
      userId: "personal_owner",
      organizationId: null,
    });
    createNotificationMock.mockResolvedValue({ created: true });

    await requestCreateGrant({
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
