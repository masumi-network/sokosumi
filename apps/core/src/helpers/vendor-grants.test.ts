import { VendorGrantScope, VendorGrantStatus } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { testVendor } from "@/test-fixtures/vendor";

import {
  buildDelegatedCoworkerTaskListAccessFilter,
  buildDelegatedWorkspaceAwaitingVendorApprovalTaskFilter,
  buildSessionWorkspaceAwaitingVendorApprovalTaskFilter,
  getDelegatedVendorGrantState,
  hasAutonomyGrant,
  isGrantDenied,
  isTaskAwaitingVendorApproval,
  isVendorSiblingInWorkspace,
  requireDelegatedVendorAutonomyForAssignee,
  requireTaskNotAwaitingVendorApproval,
  resolveRequiredGrantScope,
} from "./vendor-grants";

const {
  vendorGrantFindManyMock,
  vendorGrantFindUniqueMock,
  coworkerFindUniqueMock,
  getEnvMock,
} = vi.hoisted(() => ({
  vendorGrantFindManyMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
  coworkerFindUniqueMock: vi.fn(),
  getEnvMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

describe("buildSessionWorkspaceAwaitingVendorApprovalTaskFilter", () => {
  it("allows approved tasks and awaiting-approval tasks owned by the session user", () => {
    expect(
      buildSessionWorkspaceAwaitingVendorApprovalTaskFilter("user_owner"),
    ).toEqual({
      OR: [{ pendingVendorGrantId: null }, { userId: "user_owner" }],
    });
  });
});

describe("buildDelegatedWorkspaceAwaitingVendorApprovalTaskFilter", () => {
  it("allows approved tasks and awaiting-approval tasks assigned to the actor", () => {
    expect(
      buildDelegatedWorkspaceAwaitingVendorApprovalTaskFilter("cow_actor"),
    ).toEqual({
      OR: [{ pendingVendorGrantId: null }, { coworkerId: "cow_actor" }],
    });
  });
});

describe("buildDelegatedCoworkerTaskListAccessFilter", () => {
  it("allows assignee tasks and same-vendor sibling tasks", () => {
    expect(
      buildDelegatedCoworkerTaskListAccessFilter({
        coworkerId: "cow_actor",
        vendorId: testVendor.id,
      }),
    ).toEqual({
      AND: [
        {
          OR: [
            { coworkerId: "cow_actor" },
            {
              pendingVendorGrantId: null,
              status: { not: TaskStatus.DRAFT },
              coworkerId: { not: "cow_actor" },
              coworker: {
                vendorId: testVendor.id,
              },
            },
          ],
        },
      ],
    });
  });
});

describe("resolveRequiredGrantScope", () => {
  it("returns VENDOR when assignee shares the actor vendor", () => {
    expect(resolveRequiredGrantScope(testVendor.id, testVendor.id)).toBe(
      VendorGrantScope.VENDOR,
    );
  });

  it("returns WORKSPACE for cross-vendor assignees", () => {
    expect(
      resolveRequiredGrantScope(
        testVendor.id,
        "01960001-0001-7001-8001-000000000002",
      ),
    ).toBe(VendorGrantScope.WORKSPACE);
  });
});

describe("isTaskAwaitingVendorApproval", () => {
  it("treats explicit grant ids as awaiting vendor approval", () => {
    expect(
      isTaskAwaitingVendorApproval({ pendingVendorGrantId: "grant_1" }),
    ).toBe(true);
  });

  it("treats null and missing ids as not awaiting vendor approval", () => {
    expect(isTaskAwaitingVendorApproval({ pendingVendorGrantId: null })).toBe(
      false,
    );
    expect(isTaskAwaitingVendorApproval({})).toBe(false);
  });
});

describe("requireTaskNotAwaitingVendorApproval", () => {
  it("throws when the task is awaiting vendor approval", () => {
    expect(() =>
      requireTaskNotAwaitingVendorApproval({ pendingVendorGrantId: "grant_1" }),
    ).toThrow(HTTPException);
  });

  it("allows tasks not awaiting vendor approval", () => {
    expect(() =>
      requireTaskNotAwaitingVendorApproval({ pendingVendorGrantId: null }),
    ).not.toThrow();
  });
});

describe("isVendorSiblingInWorkspace", () => {
  const delegatedActor = {
    actor: "coworker" as const,
    coworkerId: "cow_actor",
    vendorId: testVendor.id,
    delegation: {
      userId: "user_123",
      organizationId: null,
    },
  };

  it("returns true for same-vendor non-assignee tasks", () => {
    expect(
      isVendorSiblingInWorkspace(delegatedActor, {
        coworkerId: "cow_assignee",
        status: TaskStatus.READY,
        pendingVendorGrantId: null,
        coworker: { vendorId: testVendor.id },
      }),
    ).toBe(true);
  });

  it("returns false for tasks awaiting vendor approval, draft, bare, or cross-vendor tasks", () => {
    const assigneeTask = {
      coworkerId: "cow_assignee",
      status: TaskStatus.READY,
      pendingVendorGrantId: null,
      coworker: { vendorId: testVendor.id },
    };

    expect(
      isVendorSiblingInWorkspace(
        { actor: "coworker", coworkerId: "cow_actor", vendorId: testVendor.id },
        assigneeTask,
      ),
    ).toBe(false);

    expect(
      isVendorSiblingInWorkspace(delegatedActor, {
        ...assigneeTask,
        pendingVendorGrantId: "grant_1",
      }),
    ).toBe(false);

    expect(
      isVendorSiblingInWorkspace(delegatedActor, {
        ...assigneeTask,
        status: TaskStatus.DRAFT,
      }),
    ).toBe(false);

    expect(
      isVendorSiblingInWorkspace(delegatedActor, {
        ...assigneeTask,
        coworker: { vendorId: "01960001-0001-7001-8001-000000000002" },
      }),
    ).toBe(false);
  });
});

describe("hasAutonomyGrant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts WORKSPACE grants for VENDOR scope requests", async () => {
    vendorGrantFindManyMock.mockResolvedValue([{ id: "grant_1" }]);

    const tx = { vendorGrant: { findMany: vendorGrantFindManyMock } };

    await expect(
      hasAutonomyGrant(
        {
          vendorId: testVendor.id,
          userId: "user_123",
          workspaceId: "11111111-1111-4111-8111-111111111111",
          scope: VendorGrantScope.VENDOR,
        },
        tx as never,
      ),
    ).resolves.toBe(true);

    expect(vendorGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope: {
            in: [VendorGrantScope.VENDOR, VendorGrantScope.WORKSPACE],
          },
        }),
      }),
    );
  });

  it("requires WORKSPACE scope for workspace-only requests", async () => {
    vendorGrantFindManyMock.mockResolvedValue([]);

    const tx = { vendorGrant: { findMany: vendorGrantFindManyMock } };

    await hasAutonomyGrant(
      {
        vendorId: testVendor.id,
        userId: "user_123",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        scope: VendorGrantScope.WORKSPACE,
      },
      tx as never,
    );

    expect(vendorGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope: { in: [VendorGrantScope.WORKSPACE] },
        }),
      }),
    );
  });
});

describe("isGrantDenied", () => {
  it("flags denied and revoked grants", () => {
    expect(isGrantDenied(VendorGrantStatus.DENIED)).toBe(true);
    expect(isGrantDenied(VendorGrantStatus.REVOKED)).toBe(true);
    expect(isGrantDenied(VendorGrantStatus.PENDING)).toBe(false);
    expect(isGrantDenied(VendorGrantStatus.GRANTED)).toBe(false);
  });
});

describe("getDelegatedVendorGrantState", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const tx = {
    coworker: { findUnique: coworkerFindUniqueMock },
    vendorGrant: { findUnique: vendorGrantFindUniqueMock },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    coworkerFindUniqueMock.mockResolvedValue({ vendorId: testVendor.id });
  });

  it("throws grant_denied when the grant was revoked", async () => {
    vendorGrantFindUniqueMock.mockResolvedValue({
      id: "grant_1",
      status: VendorGrantStatus.REVOKED,
    });

    await expect(
      getDelegatedVendorGrantState(
        {
          actorVendorId: testVendor.id,
          userId: "user_123",
          workspaceId,
          assigneeCoworkerId: "cow_assignee",
        },
        tx as never,
      ),
    ).rejects.toBeInstanceOf(HTTPException);
  });

  it("returns granted when autonomy exists", async () => {
    vendorGrantFindUniqueMock.mockResolvedValue({
      id: "grant_1",
      status: VendorGrantStatus.GRANTED,
    });

    await expect(
      getDelegatedVendorGrantState(
        {
          actorVendorId: testVendor.id,
          userId: "user_123",
          workspaceId,
          assigneeCoworkerId: "cow_assignee",
        },
        tx as never,
      ),
    ).resolves.toEqual({
      scope: VendorGrantScope.VENDOR,
      existingGrant: {
        id: "grant_1",
        status: VendorGrantStatus.GRANTED,
      },
      granted: true,
    });
  });
});

describe("requireDelegatedVendorAutonomyForAssignee", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const tx = {
    coworker: { findUnique: coworkerFindUniqueMock },
    vendorGrant: {
      findUnique: vendorGrantFindUniqueMock,
      findMany: vendorGrantFindManyMock,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    coworkerFindUniqueMock.mockResolvedValue({ vendorId: testVendor.id });
  });

  it("throws grant_denied when autonomy is missing", async () => {
    vendorGrantFindUniqueMock.mockResolvedValue(null);
    vendorGrantFindManyMock.mockResolvedValue([]);

    await expect(
      requireDelegatedVendorAutonomyForAssignee(
        {
          actorVendorId: testVendor.id,
          userId: "user_123",
          workspaceId,
          assigneeCoworkerId: "cow_assignee",
        },
        tx as never,
      ),
    ).rejects.toBeInstanceOf(HTTPException);
  });
});
