import assert from "node:assert/strict";

import { beforeEach, describe, it } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";
import { vendorGrantRepository } from "../vendor-grant.repository.js";
import { workspaceRepository } from "../workspace.repository.js";
import { PersonalWorkspaceMissingError } from "../workspace-errors.js";

describe("workspaceRepository", () => {
  beforeEach(() => {
    vendorGrantRepository.clearServiceplanGrantWorkspaceCacheForTests();
  });

  it("returns the existing personal workspace when resolving a personal context", async () => {
    let findUniqueCall: unknown;
    let grantFindUniqueCall: unknown;
    const tx = {
      workspace: {
        findUnique: async (args: unknown) => {
          findUniqueCall = args;
          return {
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            id: "workspace-user-1",
            organizationId: null,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            userId: "user-1",
          };
        },
        create: async () => {
          throw new Error("create should not be called");
        },
      },
      vendorGrant: {
        findUnique: async (args: unknown) => {
          grantFindUniqueCall = args;
          return null;
        },
        create: async () => ({ id: "grant-1" }),
      },
      vendor: {
        findUnique: async () => ({
          id: "01960001-0001-7001-8001-000000000001",
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const workspace = await workspaceRepository.resolveWorkspaceForContext(
      "user-1",
      null,
      tx,
    );

    assert.equal(workspace.id, "workspace-user-1");
    assert.deepEqual(findUniqueCall, {
      where: { userId: "user-1" },
    });
    assert.deepEqual(grantFindUniqueCall, {
      where: {
        vendorId_workspaceId: {
          vendorId: "01960001-0001-7001-8001-000000000001",
          workspaceId: "workspace-user-1",
        },
      },
      select: { id: true },
    });
  });

  it("creates the organization workspace when it is missing", async () => {
    let findUniqueCall: unknown;
    let createCall: unknown;
    let grantCreateCall: unknown;
    const tx = {
      workspace: {
        findUnique: async (args: unknown) => {
          findUniqueCall = args;
          return null;
        },
        create: async (args: unknown) => {
          createCall = args;
          return {
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            id: "workspace-org-1",
            organizationId: "org-1",
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            userId: null,
          };
        },
      },
      vendorGrant: {
        findUnique: async () => null,
        create: async (args: unknown) => {
          grantCreateCall = args;
          return { id: "grant-1" };
        },
      },
      vendor: {
        findUnique: async () => ({
          id: "01960001-0001-7001-8001-000000000001",
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const workspace = await workspaceRepository.resolveWorkspaceForContext(
      "user-1",
      "org-1",
      tx,
    );

    assert.equal(workspace.id, "workspace-org-1");
    assert.deepEqual(findUniqueCall, {
      where: { organizationId: "org-1" },
    });
    assert.deepEqual(createCall, {
      data: { organizationId: "org-1" },
    });
    assert.deepEqual(grantCreateCall, {
      data: {
        vendorId: "01960001-0001-7001-8001-000000000001",
        workspaceId: "workspace-org-1",
        permission: "workspace",
        status: "GRANTED",
        resolvedAt: (grantCreateCall as { data: { resolvedAt: Date } }).data
          .resolvedAt,
        resolvedById: null,
      },
    });
  });

  it("does not create a personal workspace when resolving a missing personal context", async () => {
    let createCalled = false;
    const tx = {
      workspace: {
        findUnique: async () => null,
        create: async () => {
          createCalled = true;
          throw new Error("create should not be called");
        },
      },
      vendorGrant: {
        findUnique: async () => null,
        create: async () => ({ id: "grant-1" }),
      },
      vendor: {
        findUnique: async () => ({
          id: "01960001-0001-7001-8001-000000000001",
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await assert.rejects(
      () => workspaceRepository.resolveWorkspaceForContext("user-1", null, tx),
      PersonalWorkspaceMissingError,
    );
    assert.equal(createCalled, false);
  });

  it("creates a missing personal workspace without clearing preferredOrganizationId", async () => {
    let createCall: unknown;
    let userUpdateCalled = false;
    const tx = {
      workspace: {
        findUnique: async () => null,
        create: async (args: unknown) => {
          createCall = args;
          return {
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            id: "workspace-user-2",
            organizationId: null,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            userId: "user-2",
          };
        },
      },
      user: {
        update: async () => {
          userUpdateCalled = true;
          throw new Error("must not clear preferredOrganizationId");
        },
      },
      vendorGrant: {
        findUnique: async () => null,
        create: async () => ({ id: "grant-1" }),
      },
      vendor: {
        findUnique: async () => ({
          id: "01960001-0001-7001-8001-000000000001",
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await workspaceRepository.ensurePersonalWorkspaceKeepingPreferred({
        userId: "user-2",
        tx,
      });

    assert.equal(result.created, true);
    assert.equal(result.workspace.id, "workspace-user-2");
    assert.deepEqual(createCall, {
      data: { userId: "user-2" },
    });
    assert.equal(userUpdateCalled, false);
  });

  it("returns the existing personal workspace without creating", async () => {
    let createCalled = false;
    const existing = {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: "workspace-user-1",
      organizationId: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userId: "user-1",
    };
    const tx = {
      workspace: {
        findUnique: async () => existing,
        create: async () => {
          createCalled = true;
          throw new Error("create should not be called");
        },
      },
      user: {
        update: async () => {
          throw new Error("must not clear preferredOrganizationId");
        },
      },
      vendorGrant: {
        findUnique: async () => ({ id: "grant-1" }),
        create: async () => ({ id: "grant-1" }),
      },
      vendor: {
        findUnique: async () => ({
          id: "01960001-0001-7001-8001-000000000001",
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await workspaceRepository.ensurePersonalWorkspaceKeepingPreferred({
        userId: "user-1",
        tx,
      });

    assert.equal(result.created, false);
    assert.equal(result.workspace.id, "workspace-user-1");
    assert.equal(createCalled, false);
  });
});
