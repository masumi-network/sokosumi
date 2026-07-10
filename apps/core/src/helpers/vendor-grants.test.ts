import { VendorGrantScope, VendorGrantStatus } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { testVendor } from "@/test-fixtures/vendor";

import {
  buildDelegatedWorkspaceAwaitingVendorApprovalTaskFilter,
  buildNonOwnerAwaitingVendorApprovalTaskFilter,
  hasAutonomyGrant,
  isGrantDenied,
  isTaskAwaitingVendorApproval,
  isVendorSiblingInWorkspace,
  requireTaskNotAwaitingVendorApproval,
  resolveRequiredGrantScope,
} from "./vendor-grants";

const { vendorGrantFindManyMock } = vi.hoisted(() => ({
  vendorGrantFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

describe("buildNonOwnerAwaitingVendorApprovalTaskFilter", () => {
  it("requires pendingVendorGrantId to be null", () => {
    expect(buildNonOwnerAwaitingVendorApprovalTaskFilter()).toEqual({
      pendingVendorGrantId: null,
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
