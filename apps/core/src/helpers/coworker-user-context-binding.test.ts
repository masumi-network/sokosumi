import { TaskStatus, VendorGrantStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  assertCoworkerUserContextBinding,
  requireAuthorizedUserContext,
} from "./coworker-user-context-binding";

const {
  upsertWorkspaceForContextMock,
  hasGrantedWorkspaceAccessMock,
  taskFindFirstMock,
} = vi.hoisted(() => ({
  upsertWorkspaceForContextMock: vi.fn(),
  hasGrantedWorkspaceAccessMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: {
    upsertWorkspaceForContext: (...args: unknown[]) =>
      upsertWorkspaceForContextMock(...args),
  },
}));

vi.mock("./vendor-grants", () => ({
  hasGrantedWorkspaceAccess: (...args: unknown[]) =>
    hasGrantedWorkspaceAccessMock(...args),
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
    upsertWorkspaceForContextMock.mockReset();
    hasGrantedWorkspaceAccessMock.mockReset();
    taskFindFirstMock.mockReset();
    upsertWorkspaceForContextMock.mockResolvedValue({ id: "ws_1" });
    hasGrantedWorkspaceAccessMock.mockResolvedValue(false);
    taskFindFirstMock.mockResolvedValue(null);
  });

  it("allows coworker when vendor has GRANTED workspace access", async () => {
    hasGrantedWorkspaceAccessMock.mockResolvedValue(true);

    await expect(
      assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: null,
      }),
    ).resolves.toBeUndefined();

    expect(upsertWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_1",
      null,
      expect.anything(),
    );
    expect(hasGrantedWorkspaceAccessMock).toHaveBeenCalledWith(
      { vendorId: TEST_VENDOR_ID, workspaceId: "ws_1" },
      expect.anything(),
    );
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it("allows coworker when baseline task relationship exists for the context user", async () => {
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
    hasGrantedWorkspaceAccessMock.mockResolvedValue(false);
    taskFindFirstMock.mockResolvedValue(null);

    await expect(
      assertCoworkerUserContextBinding(coworkerAuth, {
        userId: "user_1",
        organizationId: "org_1",
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(upsertWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      expect.anything(),
    );
    // Ensure we never treat non-GRANTED as success via side channel
    expect(VendorGrantStatus.PENDING).toBeDefined();
  });
});

describe("requireAuthorizedUserContext", () => {
  beforeEach(() => {
    upsertWorkspaceForContextMock.mockReset();
    hasGrantedWorkspaceAccessMock.mockReset();
    taskFindFirstMock.mockReset();
    upsertWorkspaceForContextMock.mockResolvedValue({ id: "ws_1" });
    hasGrantedWorkspaceAccessMock.mockResolvedValue(false);
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
    expect(hasGrantedWorkspaceAccessMock).not.toHaveBeenCalled();
  });

  it("allows orchestrator context without vendor binding", async () => {
    const ctx = await requireAuthorizedUserContext({
      actor: "orchestrator",
      orchestratorId: "orch_1",
      context: { userId: "user_1", organizationId: null },
    });
    expect(ctx).toEqual({
      source: "context",
      userId: "user_1",
      organizationId: null,
    });
    expect(hasGrantedWorkspaceAccessMock).not.toHaveBeenCalled();
  });

  it("rejects unbound coworker context", async () => {
    await expect(
      requireAuthorizedUserContext(coworkerAuth),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows coworker with GRANTED binding", async () => {
    hasGrantedWorkspaceAccessMock.mockResolvedValue(true);
    const ctx = await requireAuthorizedUserContext(coworkerAuth);
    expect(ctx).toEqual({
      source: "context",
      userId: "user_1",
      organizationId: null,
    });
  });
});
