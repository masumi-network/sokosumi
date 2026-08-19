import { TaskStatus, VendorGrantStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  assertCoworkerUserContextBinding,
  requireAuthorizedUserContext,
} from "./coworker-user-context-binding";

const {
  resolveWorkspaceForContextMock,
  getWorkspaceGrantMock,
  isGrantDeniedOrRevokedMock,
  throwGrantAccessErrorMock,
  taskFindFirstMock,
} = vi.hoisted(() => ({
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

  it("404s when personal workspace is missing", async () => {
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
    ).rejects.toMatchObject({ status: 404 });
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
